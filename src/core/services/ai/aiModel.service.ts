import { and, asc, eq, ne, or } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { aiModel, type AiModel, type InsertAiModel, type ProviderPreferencesJson } from '@/core/db/schema/main';
import { ConflictException, NotFoundException } from '@/core/exceptions';
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
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
}

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
          scheduleProvider: input.scheduleProvider ?? null,
          manualProvider: input.manualProvider ?? null,
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
    'key' | 'modelId' | 'isActive' | 'scheduleEnabled' | 'manualEnabled' | 'scheduleProvider' | 'manualProvider'
  >
>;

async function updateModel(id: number, data: UpdateModelInput): Promise<AiModel> {
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
  computeCostUsd
};
