import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  aiModel,
  aiModelProviderPref,
  aiModelProviderPrefValue,
  type AiModel,
  type AiModelProviderPrefValue,
  type InsertAiModel,
  type ProviderPreferencesJson
} from '@/core/db/schema/main';
import { ConflictException, NotFoundException } from '@/core/exceptions';
import {
  fromProviderPreferences,
  isEmptyProviderPreferences,
  normalizeProviderPreferencesJson,
  toProviderPreferences
} from './providerPref.mapper';
import openrouterCatalogService from './openrouterCatalog.service';

export type AiModelConflictField = 'key' | 'modelId';

interface AiModelConflictLookupInput {
  key?: string;
  modelId?: string;
  excludeId?: number;
}

interface CreateModelInput {
  key: string;
  modelId: string;
  isActive: boolean;
  scheduleEnabled?: boolean;
  manualEnabled?: boolean;
  readingEnabled?: boolean;
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
}

// Context duy nhất hiện dùng bảng normalize. Xem comment ở schema/main.ts.
const READING_PREF_CONTEXT = 'reading';

// Các cột giá được nạp từ catalog OpenRouter, không do admin nhập tay.
type PricingSnapshot = Pick<
  InsertAiModel,
  'pricePromptPerToken' | 'priceCompletionPerToken' | 'pricingRaw' | 'openrouterMeta' | 'pricingSyncedAt'
>;

/**
 * Lấy snapshot giá từ catalog. Model không có trên catalog (custom/off-catalog)
 * trả null — caller vẫn tạo/giữ row, chỉ là không tính được cost.
 */
async function fetchPricingSnapshot(modelId: string): Promise<PricingSnapshot | null> {
  try {
    const catalogModel = await openrouterCatalogService.getCatalogModel(modelId);
    if (!catalogModel) {
      logger.warn(`[AiModelService] Model "${modelId}" không có trên OpenRouter catalog, bỏ qua pricing`);
      return null;
    }
    return {
      pricePromptPerToken: catalogModel.pricing.prompt,
      priceCompletionPerToken: catalogModel.pricing.completion,
      pricingRaw: { ...catalogModel.pricing },
      openrouterMeta: {
        name: catalogModel.name,
        contextLength: catalogModel.contextLength,
        supportedParameters: catalogModel.supportedParameters,
        topProvider: catalogModel.topProvider
      },
      pricingSyncedAt: new Date()
    };
  } catch (err) {
    logger.warn(`[AiModelService] Không lấy được pricing cho "${modelId}": ${err}`);
    return null;
  }
}

/**
 * Chi phí USD của 1 lần gọi. null khi model chưa có giá cache — phân biệt rõ với
 * 0 (gọi thật nhưng model free).
 */
export function computeCostUsd(
  model: Pick<AiModel, 'pricePromptPerToken' | 'priceCompletionPerToken'> | null | undefined,
  tokenIn: number,
  tokenOut: number
): number | null {
  if (!model) return null;
  const { pricePromptPerToken, priceCompletionPerToken } = model;
  if (pricePromptPerToken === null && priceCompletionPerToken === null) return null;
  return (pricePromptPerToken ?? 0) * tokenIn + (priceCompletionPerToken ?? 0) * tokenOut;
}

/**
 * Cộng chi phí nhiều lời gọi. Giữ null khi KHÔNG lời gọi nào có giá — cộng thành 0 sẽ bị hiểu
 * nhầm là "chạy miễn phí".
 */
export function sumCostUsd(costs: Array<number | null | undefined>): number | null {
  const priced = costs.filter((cost): cost is number => typeof cost === 'number');
  return priced.length === 0 ? null : priced.reduce((sum, cost) => sum + cost, 0);
}

const UNIQUE_CONSTRAINT_TO_FIELD: Record<string, AiModelConflictField> = {
  ai_models_key_unique: 'key',
  ai_models_modelId_unique: 'modelId'
};

async function getAllModels(): Promise<AiModel[]> {
  return db.select().from(aiModel).orderBy(asc(aiModel.id));
}

async function getActiveModels(): Promise<AiModel[]> {
  return db.select().from(aiModel).where(eq(aiModel.isActive, true)).orderBy(asc(aiModel.id));
}

async function getModelById(id: number): Promise<AiModel | null> {
  const [model] = await db.select().from(aiModel).where(eq(aiModel.id, id)).limit(1);
  return model ?? null;
}

async function getModelByModelId(modelId: string): Promise<AiModel | null> {
  const [model] = await db.select().from(aiModel).where(eq(aiModel.modelId, modelId)).limit(1);
  return model ?? null;
}

async function findConflict({
  key,
  modelId,
  excludeId
}: AiModelConflictLookupInput): Promise<AiModelConflictField | null> {
  const conditions = [];
  if (key) conditions.push(eq(aiModel.key, key));
  if (modelId) conditions.push(eq(aiModel.modelId, modelId));
  if (conditions.length === 0) return null;

  const matchCondition = conditions.length === 1 ? conditions[0]! : or(...conditions);
  const whereClause = excludeId === undefined ? matchCondition : and(matchCondition, ne(aiModel.id, excludeId));

  const matches = await db.select().from(aiModel).where(whereClause);
  if (key && matches.some((model) => model.key === key)) return 'key';
  if (modelId && matches.some((model) => model.modelId === modelId)) return 'modelId';
  return null;
}

const FIELD_TO_MESSAGE: Record<AiModelConflictField, string> = {
  key: '[AiModelService] "key" đã tồn tại',
  modelId: '[AiModelService] "modelId" đã tồn tại'
};

function toConflictError(err: unknown): ConflictException | null {
  if (!(err instanceof Error)) return null;

  const constraint =
    'constraint' in err && typeof err.constraint === 'string'
      ? err.constraint
      : 'cause' in err &&
          err.cause &&
          typeof err.cause === 'object' &&
          'constraint' in err.cause &&
          typeof err.cause.constraint === 'string'
        ? err.cause.constraint
        : null;

  const code =
    'code' in err && typeof err.code === 'string'
      ? err.code
      : 'cause' in err &&
          err.cause &&
          typeof err.cause === 'object' &&
          'code' in err.cause &&
          typeof err.cause.code === 'string'
        ? err.cause.code
        : null;

  if (code !== '23505' || !constraint) return null;

  const field = UNIQUE_CONSTRAINT_TO_FIELD[constraint];
  return field ? new ConflictException(FIELD_TO_MESSAGE[field]) : null;
}

async function createModel(input: CreateModelInput): Promise<AiModel> {
  const { key, modelId, isActive } = input;
  // Validate provider trước khi gọi catalog: input sai phải bị chặn ngay, không tốn request.
  const scheduleProvider = normalizeProviderPreferencesJson(input.scheduleProvider);
  const manualProvider = normalizeProviderPreferencesJson(input.manualProvider);
  // Nạp giá ngay lúc tạo để cost tracking có số liệu từ lần sinh câu hỏi đầu tiên.
  const pricing = await fetchPricingSnapshot(modelId);
  try {
    const [created] = await db.transaction(async (tx) =>
      tx
        .insert(aiModel)
        .values({
          key,
          modelId,
          isActive,
          scheduleEnabled: input.scheduleEnabled ?? true,
          manualEnabled: input.manualEnabled ?? true,
          readingEnabled: input.readingEnabled ?? true,
          scheduleProvider,
          manualProvider,
          ...pricing
        })
        .returning()
    );
    if (!created) throw new Error(`[AiModelService] Failed to create model: ${key}`);
    logger.info(
      `[AiModelService] Created model id=${created.id} key="${key}" modelId="${modelId}" priced=${pricing !== null}`
    );
    return created;
  } catch (err) {
    const conflictError = toConflictError(err);
    if (conflictError) throw conflictError;
    throw err;
  }
}

type UpdateModelInput = Partial<
  Pick<
    InsertAiModel,
    | 'key'
    | 'modelId'
    | 'isActive'
    | 'scheduleEnabled'
    | 'manualEnabled'
    | 'readingEnabled'
    | 'scheduleProvider'
    | 'manualProvider'
  >
>;

async function updateModel(id: number, input: UpdateModelInput): Promise<AiModel> {
  // Provider jsonb đi qua cùng rule validate với context reading (undefined = không đổi).
  const data: UpdateModelInput = { ...input };
  if (input.scheduleProvider !== undefined)
    data.scheduleProvider = normalizeProviderPreferencesJson(input.scheduleProvider);
  if (input.manualProvider !== undefined) data.manualProvider = normalizeProviderPreferencesJson(input.manualProvider);
  // Đổi modelId → giá cũ không còn đúng, nạp lại snapshot của model mới.
  const pricing = data.modelId ? await fetchPricingSnapshot(data.modelId) : null;
  try {
    const [updated] = await db.transaction(async (tx) =>
      tx
        .update(aiModel)
        .set({ ...data, ...(pricing ?? {}), updatedAt: new Date() })
        .where(eq(aiModel.id, id))
        .returning()
    );
    if (!updated) throw new NotFoundException(`[AiModelService] Không tìm thấy model: ${id}`);
    logger.info(`[AiModelService] Updated model id=${id}`);
    return updated;
  } catch (err) {
    const conflictError = toConflictError(err);
    if (conflictError) throw conflictError;
    throw err;
  }
}

async function syncModelPricing(id: number): Promise<AiModel> {
  const existing = await getModelById(id);
  if (!existing) throw new NotFoundException(`[AiModelService] Không tìm thấy model: ${id}`);

  const pricing = await fetchPricingSnapshot(existing.modelId);
  if (!pricing) {
    throw new NotFoundException(
      `[AiModelService] Model "${existing.modelId}" không có trên OpenRouter catalog, không sync được giá`
    );
  }

  const [updated] = await db.transaction(async (tx) =>
    tx
      .update(aiModel)
      .set({ ...pricing, updatedAt: new Date() })
      .where(eq(aiModel.id, id))
      .returning()
  );
  if (!updated) throw new NotFoundException(`[AiModelService] Không tìm thấy model: ${id}`);
  logger.info(`[AiModelService] Synced pricing model id=${id} modelId="${existing.modelId}"`);
  return updated;
}

async function syncAllModelsPricing(): Promise<{ synced: number; notFound: string[] }> {
  const models = await getAllModels();
  const notFound: string[] = [];
  let synced = 0;

  for (const model of models) {
    const pricing = await fetchPricingSnapshot(model.modelId);
    if (!pricing) {
      notFound.push(model.modelId);
      continue;
    }
    await db.transaction(async (tx) =>
      tx
        .update(aiModel)
        .set({ ...pricing, updatedAt: new Date() })
        .where(eq(aiModel.id, model.id))
    );
    synced++;
  }

  logger.info(`[AiModelService] Synced pricing for ${synced}/${models.length} models, notFound=${notFound.length}`);
  return { synced, notFound };
}

// ─── Reading provider preferences (2 bảng normalize) ─────────────────────────────

/**
 * Provider routing context 'reading' của nhiều model trong 2 query, không phải N+1.
 * Model chưa cấu hình gì thì không có key trong Map (caller đọc ra undefined).
 */
async function getReadingProvidersByModelRefIds(
  modelRefIds: number[]
): Promise<Map<number, ProviderPreferencesJson | undefined>> {
  const result = new Map<number, ProviderPreferencesJson | undefined>();
  if (modelRefIds.length === 0) return result;

  const prefs = await db
    .select()
    .from(aiModelProviderPref)
    .where(
      and(inArray(aiModelProviderPref.modelRefId, modelRefIds), eq(aiModelProviderPref.context, READING_PREF_CONTEXT))
    );
  if (prefs.length === 0) return result;

  const valueRows = await db
    .select()
    .from(aiModelProviderPrefValue)
    .where(
      inArray(
        aiModelProviderPrefValue.prefRefId,
        prefs.map((pref) => pref.id)
      )
    );

  const valuesByPrefId = new Map<number, AiModelProviderPrefValue[]>();
  for (const row of valueRows) {
    const bucket = valuesByPrefId.get(row.prefRefId) ?? [];
    bucket.push(row);
    valuesByPrefId.set(row.prefRefId, bucket);
  }

  for (const pref of prefs) {
    result.set(pref.modelRefId, toProviderPreferences(pref, valuesByPrefId.get(pref.id) ?? []));
  }
  return result;
}

async function getReadingProvider(modelRefId: number): Promise<ProviderPreferencesJson | undefined> {
  const map = await getReadingProvidersByModelRefIds([modelRefId]);
  return map.get(modelRefId);
}

/**
 * Ghi đè toàn bộ provider routing 'reading' của 1 model (replace, không merge —
 * cùng cách hành xử với setTopicAccess). `input = null` hoặc object rỗng → xoá sạch
 * row, model quay về "không có provider preference".
 */
async function setReadingProvider(modelRefId: number, input: ProviderPreferencesJson | null): Promise<void> {
  const parsed = input === null ? null : fromProviderPreferences(input);
  const shouldClear = parsed === null || isEmptyProviderPreferences(parsed.columns, parsed.values);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiModelProviderPref.id })
      .from(aiModelProviderPref)
      .where(and(eq(aiModelProviderPref.modelRefId, modelRefId), eq(aiModelProviderPref.context, READING_PREF_CONTEXT)))
      .limit(1);

    if (shouldClear) {
      if (!existing) return;
      await tx.delete(aiModelProviderPrefValue).where(eq(aiModelProviderPrefValue.prefRefId, existing.id));
      await tx.delete(aiModelProviderPref).where(eq(aiModelProviderPref.id, existing.id));
      return;
    }

    const [pref] = await tx
      .insert(aiModelProviderPref)
      .values({ modelRefId, context: READING_PREF_CONTEXT, ...parsed.columns })
      .onConflictDoUpdate({
        target: [aiModelProviderPref.modelRefId, aiModelProviderPref.context],
        set: { ...parsed.columns, updatedAt: new Date() }
      })
      .returning({ id: aiModelProviderPref.id });
    if (!pref) throw new Error(`[AiModelService] Failed to upsert provider pref for model ${modelRefId}`);

    await tx.delete(aiModelProviderPrefValue).where(eq(aiModelProviderPrefValue.prefRefId, pref.id));
    if (parsed.values.length > 0) {
      await tx
        .insert(aiModelProviderPrefValue)
        .values(parsed.values.map((value) => ({ prefRefId: pref.id, ...value })));
    }
  });

  logger.info(`[AiModelService] Set reading provider modelRefId=${modelRefId} cleared=${shouldClear}`);
}

export type AiModelWithReadingProvider = AiModel & { readingProvider: ProviderPreferencesJson | null };

async function attachReadingProvider(models: AiModel[]): Promise<AiModelWithReadingProvider[]> {
  const providers = await getReadingProvidersByModelRefIds(models.map((model) => model.id));
  return models.map((model) => ({ ...model, readingProvider: providers.get(model.id) ?? null }));
}

/** Bản dành cho admin UI — các call site sinh nội dung không cần pref này nên giữ getAllModels() nguyên vẹn. */
async function getAllModelsWithReadingProvider(): Promise<AiModelWithReadingProvider[]> {
  return attachReadingProvider(await getAllModels());
}

async function getModelByIdWithReadingProvider(id: number): Promise<AiModelWithReadingProvider | null> {
  const model = await getModelById(id);
  if (!model) return null;
  const [withProvider] = await attachReadingProvider([model]);
  return withProvider ?? null;
}

export default {
  getAllModels,
  getActiveModels,
  getModelById,
  getModelByModelId,
  findConflict,
  createModel,
  updateModel,
  syncModelPricing,
  syncAllModelsPricing,
  computeCostUsd,
  getReadingProvider,
  getReadingProvidersByModelRefIds,
  setReadingProvider,
  getAllModelsWithReadingProvider,
  getModelByIdWithReadingProvider
};
