import { and, asc, eq, ne, or } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { aiModel, type AiModel, type InsertAiModel } from '@/core/db/schema/main';

export type AiModelConflictField = 'key' | 'modelId';

export class AiModelConflictError extends Error {
  readonly field: AiModelConflictField;

  constructor(field: AiModelConflictField) {
    super(`[AiModelService] Duplicate ${field}`);
    this.name = 'AiModelConflictError';
    this.field = field;
  }
}

interface AiModelConflictLookupInput {
  key?: string;
  modelId?: string;
  excludeId?: number;
}

interface CreateModelInput {
  key: string;
  modelId: string;
  isActive: boolean;
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

async function getActiveModelIds(): Promise<string[]> {
  const models = await getActiveModels();
  return models.map((m) => m.modelId);
}

async function getModelById(id: number): Promise<AiModel | null> {
  const [model] = await db.select().from(aiModel).where(eq(aiModel.id, id)).limit(1);
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

function toConflictError(err: unknown): AiModelConflictError | null {
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
  return field ? new AiModelConflictError(field) : null;
}

async function createModel({ key, modelId, isActive }: CreateModelInput): Promise<AiModel> {
  try {
    const [created] = await db.transaction(async (tx) =>
      tx.insert(aiModel).values({ key, modelId, isActive }).returning()
    );
    if (!created) throw new Error(`[AiModelService] Failed to create model: ${key}`);
    logger.info(`[AiModelService] Created model id=${created.id} key="${key}" modelId="${modelId}"`);
    return created;
  } catch (err) {
    const conflictError = toConflictError(err);
    if (conflictError) throw conflictError;
    throw err;
  }
}

async function updateModel(
  id: number,
  data: Partial<Pick<InsertAiModel, 'key' | 'modelId' | 'isActive'>>
): Promise<AiModel> {
  try {
    const [updated] = await db.transaction(async (tx) =>
      tx
        .update(aiModel)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiModel.id, id))
        .returning()
    );
    if (!updated) throw new Error(`[AiModelService] Model not found: ${id}`);
    logger.info(`[AiModelService] Updated model id=${id}`);
    return updated;
  } catch (err) {
    const conflictError = toConflictError(err);
    if (conflictError) throw conflictError;
    throw err;
  }
}

export default {
  getAllModels,
  getActiveModels,
  getActiveModelIds,
  getModelById,
  findConflict,
  createModel,
  updateModel
};
