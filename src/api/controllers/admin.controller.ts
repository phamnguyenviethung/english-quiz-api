import logger from '@/configs/logger.config';
import { NotFoundException } from '@/core/exceptions';
import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import poolRefillService from '@/core/services/english/poolRefill.service';
import aiModelService from '@/core/services/ai/aiModel.service';
import openrouterCatalogService from '@/core/services/ai/openrouterCatalog.service';
import { resolveStudyModels } from '@/configs/aiClient.config';
import { bucketKeyOf, type BucketFilter } from '@/core/services/english/poolRefill.service';
import { ENG_LEVELS, QUIZ_TYPES, type QuizType } from '@/core/services/english/questionTypes';
import questionPoolService from '@/core/services/english/questionPool.service';
import { BusinessLogicException } from '@/core/exceptions';
import type { DifficultyContext } from '@/core/services/english/study.service';
import type { ProviderPreferencesJson } from '@/core/db/schema/main';

// ─── Tenants ────────────────────────────────────────────────────────────────────

function listTenants() {
  return tenantService.getAllTenants();
}

async function getTenant(id: number) {
  const found = await tenantService.getTenantById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy tenant: ${id}`);
  return found;
}

interface CreateTenantInput {
  name: string;
  description?: string | null;
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
}

function createTenant(input: CreateTenantInput) {
  logger.info(`[Admin] Create tenant name="${input.name}"`);
  return tenantService.createTenant(input);
}

interface UpdateTenantInput {
  name?: string;
  description?: string | null;
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
  isActive?: boolean;
}

function updateTenant(id: number, input: UpdateTenantInput) {
  return tenantService.updateTenant(id, input);
}

// ─── AI Models ───────────────────────────────────────────────────────────────────

function listModels() {
  return aiModelService.getAllModels();
}

async function getModel(id: number) {
  const found = await aiModelService.getModelById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy model: ${id}`);
  return found;
}

interface CreateModelInput {
  key: string;
  modelId: string;
  isActive?: boolean;
  scheduleEnabled?: boolean;
  manualEnabled?: boolean;
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
}

function createModel(input: CreateModelInput) {
  logger.info(`[Admin] Create AI model key="${input.key}" modelId="${input.modelId}"`);
  return aiModelService.createModel({ ...input, isActive: input.isActive ?? true });
}

interface UpdateModelInput {
  key?: string;
  modelId?: string;
  isActive?: boolean;
  scheduleEnabled?: boolean;
  manualEnabled?: boolean;
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
}

function updateModel(id: number, input: UpdateModelInput) {
  return aiModelService.updateModel(id, input);
}

function listModelCatalog(search?: string) {
  return openrouterCatalogService.listCatalogModels({ search });
}

function syncModelPricing(id: number) {
  logger.info(`[Admin] Sync pricing for AI model id=${id}`);
  return aiModelService.syncModelPricing(id);
}

function syncAllModelsPricing() {
  logger.info('[Admin] Sync pricing for all AI models');
  return aiModelService.syncAllModelsPricing();
}

// ─── API keys ────────────────────────────────────────────────────────────────────

async function issueKey(tenantId: number, label: string | null) {
  const { record, plaintext } = await apiKeyService.issueKey(tenantId, label);
  // Plaintext CHỈ trả về đúng một lần ở đây — client phải lưu ngay.
  return {
    id: record.id,
    label: record.label,
    apiKey: plaintext,
    warning: 'Lưu apiKey ngay — giá trị đầy đủ chỉ hiển thị một lần này.'
  };
}

function listKeys(tenantId: number) {
  return apiKeyService.listKeys(tenantId);
}

async function revokeKey(tenantId: number, apiKeyId: number) {
  await apiKeyService.revokeKey(tenantId, apiKeyId);
  return { apiKeyId, revoked: true };
}

// ─── Grants (allow-list) ──────────────────────────────────────────────────────────

async function getTopicAccess(tenantId: number) {
  await tenantService.requireTenant(tenantId);
  return { tenantId, topicIds: await tenantService.getAllowedTopicIds(tenantId) };
}

async function getQuizTypeAccess(tenantId: number) {
  await tenantService.requireTenant(tenantId);
  return { tenantId, quizTypes: await tenantService.getAllowedQuizTypes(tenantId) };
}

async function setTopicAccess(tenantId: number, topicIds: number[]) {
  const applied = await tenantService.setTopicAccess(tenantId, topicIds);
  return { tenantId, topicIds: applied };
}

async function setQuizTypeAccess(tenantId: number, quizTypes: string[]) {
  const applied = await tenantService.setQuizTypeAccess(tenantId, quizTypes);
  return { tenantId, quizTypes: applied };
}

// ─── Pool ───────────────────────────────────────────────────────────────────────

interface PoolBucketFilterInput {
  engLevels?: string[];
  topicIds?: number[];
  quizTypes?: string[];
}

interface TriggerManualPoolRefillInput {
  models?: string[];
  /** @deprecated Dùng `models`. Giữ lại cho client cũ. */
  model?: string;
  countPerBucket?: number;
  scope?: 'all' | 'deficient';
  filter?: PoolBucketFilterInput;
  bucketKeys?: string[];
}

// Query của GET /admin/pool/buckets truyền list dạng "A1,B2" nên phải parse ở đây;
// body của POST /admin/pool/refill đã là array và được TypeBox validate sẵn.
function parseCsvParam(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function toBucketFilter(input: PoolBucketFilterInput | undefined): BucketFilter | undefined {
  if (!input) return undefined;

  const invalidLevels = input.engLevels?.filter((level) => !ENG_LEVELS.includes(level as never)) ?? [];
  if (invalidLevels.length > 0) throw new BusinessLogicException(`engLevel không hợp lệ: ${invalidLevels.join(', ')}`);

  const invalidQuizTypes = input.quizTypes?.filter((quizType) => !QUIZ_TYPES.includes(quizType as never)) ?? [];
  if (invalidQuizTypes.length > 0)
    throw new BusinessLogicException(`quizType không hợp lệ: ${invalidQuizTypes.join(', ')}`);

  const invalidTopicIds = input.topicIds?.filter((id) => !Number.isInteger(id)) ?? [];
  if (invalidTopicIds.length > 0)
    throw new BusinessLogicException(`topicId không hợp lệ: ${invalidTopicIds.join(', ')}`);

  const filter: BucketFilter = {
    engLevels: input.engLevels as DifficultyContext['engLevel'][] | undefined,
    topicIds: input.topicIds,
    quizTypes: input.quizTypes as QuizType[] | undefined
  };

  const hasAny = Object.values(filter).some((values) => values !== undefined && values.length > 0);
  return hasAny ? filter : undefined;
}

interface ListPoolBucketsQuery {
  engLevels?: string;
  topicIds?: string;
  quizTypes?: string;
  scope?: 'all' | 'deficient';
  countPerBucket?: number;
}

/**
 * Preview: bucket nào sẽ được refill với đúng bộ tham số này, và mỗi bucket sinh bao nhiêu câu.
 * Dùng chung buildManualRefillPlan với endpoint chạy thật nên số liệu preview không lệch.
 */
async function listPoolBuckets(query: ListPoolBucketsQuery) {
  const topicIds = parseCsvParam(query.topicIds)?.map((id) => Number(id));
  const filter = toBucketFilter({
    engLevels: parseCsvParam(query.engLevels),
    quizTypes: parseCsvParam(query.quizTypes),
    topicIds
  });

  const { matched, plan } = await poolRefillService.buildManualRefillPlan({
    scope: query.scope,
    countPerBucket: query.countPerBucket,
    filter
  });

  const plannedByKey = new Map(plan.planned.map((item) => [bucketKeyOf(item), item.count]));

  return {
    // Trả cả bucket plannedCount=0 (đã đủ câu, bị scope='deficient' bỏ qua) để UI nói được lý do
    // thay vì lặng lẽ giấu bucket đi.
    buckets: matched.map((candidate) => ({
      bucketKey: bucketKeyOf(candidate),
      engLevel: candidate.engLevel,
      quizType: candidate.quizType,
      optionCount: candidate.optionCount,
      topicId: candidate.topicId,
      topicName: candidate.topicName,
      currentCount: candidate.currentCount,
      deficiency: candidate.deficiency,
      plannedCount: plannedByKey.get(bucketKeyOf(candidate)) ?? 0
    })),
    summary: {
      matchedBuckets: matched.length,
      plannedBuckets: plan.planned.length,
      plannedQuestions: plan.planned.reduce((sum, item) => sum + item.count, 0),
      maxPerBucket: questionPoolService.getMaxPoolSize()
    }
  };
}

async function triggerManualPoolRefill(input: TriggerManualPoolRefillInput) {
  // Không truyền model nào → random trong toàn bộ pool model bật manualEnabled (hành vi cũ);
  // có truyền → validate rồi random trong đúng tập đó, mỗi bucket một model.
  const requestedModels = input.models ?? (input.model ? [input.model] : undefined);
  const models = await resolveStudyModels('manual', requestedModels);
  const filter = toBucketFilter(input.filter);

  logger.info(
    `[Admin] Manual pool refill scope=${input.scope ?? 'all'} models=${models.map((m) => m.model).join(',')} ` +
      `countPerBucket=${input.countPerBucket ?? '-'} filter=${filter ? JSON.stringify(filter) : '-'} ` +
      `selectedBuckets=${input.bucketKeys?.length ?? '-'}`
  );

  return poolRefillService.runManualRefill({
    models,
    countPerBucket: input.countPerBucket,
    scope: input.scope,
    filter,
    bucketKeys: input.bucketKeys
  });
}

export default {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  listModels,
  getModel,
  createModel,
  updateModel,
  listModelCatalog,
  syncModelPricing,
  syncAllModelsPricing,
  issueKey,
  listKeys,
  revokeKey,
  getTopicAccess,
  getQuizTypeAccess,
  setTopicAccess,
  setQuizTypeAccess,
  listPoolBuckets,
  triggerManualPoolRefill
};
