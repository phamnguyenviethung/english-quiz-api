import logger from '@/configs/logger.config';
import { NotFoundException } from '@/core/exceptions';
import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import poolRefillService from '@/core/services/english/poolRefill.service';
import aiModelService from '@/core/services/ai/aiModel.service';
import openrouterCatalogService from '@/core/services/ai/openrouterCatalog.service';
import { resolveStudyModels } from '@/configs/aiClient.config';
import { bucketKeyOf, type BucketFilter } from '@/core/services/english/poolRefill.service';
import readingRefillService, {
  readingBucketKeyOf,
  type ReadingBucketFilter
} from '@/core/services/english/readingRefill.service';
import readingPassageService, { type ReadingPassagesSort } from '@/core/services/english/readingPassage.service';
import readingQuestionRefillService, {
  readingQuestionBucketKeyOf,
  type ReadingQuestionBucketFilter
} from '@/core/services/english/readingQuestionRefill.service';
import readingQuestionService, {
  getQuestionsPerPassage,
  type ReadingQuestionsSort,
  type UpdateReadingQuestionInput
} from '@/core/services/english/readingQuestion.service';
import {
  BUCKET_AUDIENCES,
  ENG_LEVELS,
  QUIZ_TYPES,
  READING_PASSAGE_TYPES,
  isBucketAudience,
  type BucketAudience,
  type EngLevel,
  type QuizType,
  type ReadingPassageType
} from '@/core/services/english/questionTypes';
import questionPoolService from '@/core/services/english/questionPool.service';
import questionPoolReviewService, {
  type ListPoolReviewsInput
} from '@/core/services/english/questionPoolReview.service';
import siblingQuestionService from '@/core/services/english/siblingQuestion.service';
import siblingRefillService from '@/core/services/english/siblingRefill.service';
import {
  SIBLING_SUPPORTED_QUIZ_TYPES,
  getQuizTypeLabel,
  isSiblingSupported
} from '@/core/services/english/questionTypes';
import { SIBLING_LOCK_FIELDS_BY_TYPE } from '@/core/services/english/prompt/sibling-prompt';
import { BusinessLogicException } from '@/core/exceptions';
import studyService, { type DifficultyContext } from '@/core/services/english/study.service';
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
  return aiModelService.getAllModelsWithReadingProvider();
}

async function getModel(id: number) {
  const found = await aiModelService.getModelByIdWithReadingProvider(id);
  if (!found) throw new NotFoundException(`Không tìm thấy model: ${id}`);
  return found;
}

interface CreateModelInput {
  key: string;
  modelId: string;
  isActive?: boolean;
  scheduleEnabled?: boolean;
  manualEnabled?: boolean;
  readingEnabled?: boolean;
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
  readingProvider?: ProviderPreferencesJson | null;
}

// readingProvider lưu ở 2 bảng riêng nên phải ghi sau khi có model id — API bên ngoài
// vẫn chỉ thấy 1 object lồng trong body như 2 provider kia.
async function createModel(input: CreateModelInput) {
  logger.info(`[Admin] Create AI model key="${input.key}" modelId="${input.modelId}"`);
  const { readingProvider, ...modelInput } = input;
  const created = await aiModelService.createModel({ ...modelInput, isActive: input.isActive ?? true });
  if (readingProvider !== undefined) {
    await aiModelService.setReadingProvider(created.id, readingProvider);
  }
  return (await aiModelService.getModelByIdWithReadingProvider(created.id)) ?? created;
}

interface UpdateModelInput {
  key?: string;
  modelId?: string;
  isActive?: boolean;
  scheduleEnabled?: boolean;
  manualEnabled?: boolean;
  readingEnabled?: boolean;
  scheduleProvider?: ProviderPreferencesJson | null;
  manualProvider?: ProviderPreferencesJson | null;
  readingProvider?: ProviderPreferencesJson | null;
}

async function updateModel(id: number, input: UpdateModelInput) {
  const { readingProvider, ...modelInput } = input;
  const updated = await aiModelService.updateModel(id, modelInput);
  if (readingProvider !== undefined) {
    await aiModelService.setReadingProvider(id, readingProvider);
  }
  return (await aiModelService.getModelByIdWithReadingProvider(id)) ?? updated;
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
  audience?: string;
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

function toBucketAudience(value: string | undefined): BucketAudience | undefined {
  if (value === undefined) return undefined;
  if (!isBucketAudience(value)) {
    throw new BusinessLogicException(`audience không hợp lệ: ${value} (chỉ nhận ${BUCKET_AUDIENCES.join(', ')})`);
  }
  return value;
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
    quizTypes: input.quizTypes as QuizType[] | undefined,
    audience: toBucketAudience(input.audience)
  };

  const hasAny = Object.values(filter).some((values) => values !== undefined && values.length > 0);
  return hasAny ? filter : undefined;
}

interface ListPoolBucketsQuery {
  engLevels?: string;
  topicIds?: string;
  quizTypes?: string;
  audience?: string;
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
    topicIds,
    audience: query.audience
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
      forBeginner: candidate.forBeginner,
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

function setPoolQuestionForBeginner(id: number, forBeginner: boolean) {
  logger.info(`[Admin] Set pool question id=${id} forBeginner=${forBeginner}`);
  return questionPoolService.setQuestionForBeginner(id, forBeginner);
}

// ─── Pool AI review ─────────────────────────────────────────────────────────────

function enqueuePoolReviews(
  input: { poolQuestionIds: number[]; model?: string; adminNote?: string },
  requestedBy: string
) {
  logger.info(`[Admin] Enqueue pool reviews count=${input.poolQuestionIds.length} by=${requestedBy}`);
  return questionPoolReviewService.enqueueReviews(input.poolQuestionIds, {
    model: input.model,
    adminNote: input.adminNote,
    requestedBy
  });
}

function listPoolReviews(query: ListPoolReviewsInput) {
  return questionPoolReviewService.listReviews(query);
}

async function getPoolReview(id: number) {
  const found = await questionPoolReviewService.getReviewById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy review: ${id}`);
  return found;
}

function approvePoolReview(id: number, input: { data?: unknown }, userId: string) {
  logger.info(`[Admin] Approve pool review id=${id} by=${userId}`);
  return questionPoolReviewService.approveReview(id, { data: input.data, userId });
}

function rejectPoolReview(id: number, input: { note?: string }, userId: string) {
  logger.info(`[Admin] Reject pool review id=${id} by=${userId}`);
  return questionPoolReviewService.rejectReview(id, { note: input.note, userId });
}

async function deletePoolReview(id: number) {
  logger.info(`[Admin] Delete pool review id=${id}`);
  await questionPoolReviewService.deleteReview(id);
  return { id, deleted: true };
}

// ─── Pool sibling question ──────────────────────────────────────────────────────

function generatePoolSiblings(
  sourceId: number,
  input: { count: number; model?: string; adminNote?: string },
  userId: string
) {
  logger.info(`[Admin] Generate siblings pool id=${sourceId} count=${input.count} by=${userId}`);
  return siblingQuestionService.generateSiblingsForSource(sourceId, {
    count: input.count,
    model: input.model,
    adminNote: input.adminNote,
    context: 'manual',
    forceInsert: true
  });
}

function listSiblingSupportedTypes() {
  return SIBLING_SUPPORTED_QUIZ_TYPES.map((quizType) => ({
    quizType,
    label: getQuizTypeLabel(quizType),
    lockFields: SIBLING_LOCK_FIELDS_BY_TYPE[quizType]
  }));
}

// ─── Pool sibling bulk refill (admin trigger, giống pool/refill + pool/buckets) ──

/** toBucketFilter + chặn quizType ngoài danh sách hỗ trợ sinh sibling. */
function toSiblingBucketFilter(input: PoolBucketFilterInput | undefined): BucketFilter | undefined {
  const filter = toBucketFilter(input);
  const unsupported = filter?.quizTypes?.filter((quizType) => !isSiblingSupported(quizType)) ?? [];
  if (unsupported.length > 0) {
    throw new BusinessLogicException(`Loại câu không hỗ trợ sinh câu tương tự: ${unsupported.join(', ')}`);
  }
  return filter;
}

interface ListSiblingBucketsQuery {
  engLevels?: string;
  topicIds?: string;
  quizTypes?: string;
  audience?: string;
  scope?: 'all' | 'deficient';
  sourcesPerBucket?: number;
  siblingsPerSource?: number;
}

async function listPoolSiblingBuckets(query: ListSiblingBucketsQuery) {
  const topicIds = parseCsvParam(query.topicIds)?.map((id) => Number(id));
  const filter = toSiblingBucketFilter({
    engLevels: parseCsvParam(query.engLevels),
    quizTypes: parseCsvParam(query.quizTypes),
    topicIds,
    audience: query.audience
  });

  const { matched, planned, totalPlannedSiblings } = await siblingRefillService.buildManualSiblingPlan({
    scope: query.scope,
    sourcesPerBucket: query.sourcesPerBucket,
    siblingsPerSource: query.siblingsPerSource,
    filter
  });

  return {
    buckets: matched.map((item) => ({
      bucketKey: bucketKeyOf(item),
      engLevel: item.engLevel,
      quizType: item.quizType,
      optionCount: item.optionCount,
      topicId: item.topicId,
      topicName: item.topicName,
      forBeginner: item.forBeginner,
      currentCount: item.currentCount,
      deficiency: item.deficiency,
      sourceCount: item.sourceCount,
      plannedSources: item.plannedSources,
      plannedCount: item.plannedCount
    })),
    summary: {
      matchedBuckets: matched.length,
      plannedBuckets: planned.length,
      plannedSiblings: totalPlannedSiblings,
      maxPerBucket: questionPoolService.getMaxPoolSize()
    }
  };
}

interface TriggerManualPoolSiblingRefillInput {
  models?: string[];
  scope?: 'all' | 'deficient';
  sourcesPerBucket?: number;
  siblingsPerSource?: number;
  filter?: PoolBucketFilterInput;
  bucketKeys?: string[];
}

async function triggerManualPoolSiblingRefill(input: TriggerManualPoolSiblingRefillInput) {
  const models = await resolveStudyModels('manual', input.models);
  const filter = toSiblingBucketFilter(input.filter);

  logger.info(
    `[Admin] Manual sibling refill scope=${input.scope ?? 'deficient'} ` +
      `models=${models.map((m) => m.model).join(',') || '(all manual)'} ` +
      `sourcesPerBucket=${input.sourcesPerBucket ?? '-'} siblingsPerSource=${input.siblingsPerSource ?? '-'} ` +
      `filter=${filter ? JSON.stringify(filter) : '-'} selectedBuckets=${input.bucketKeys?.length ?? '-'}`
  );

  return siblingRefillService.runManualSiblingRefill({
    models,
    scope: input.scope,
    sourcesPerBucket: input.sourcesPerBucket,
    siblingsPerSource: input.siblingsPerSource,
    filter,
    bucketKeys: input.bucketKeys
  });
}

// ─── Reading passages ───────────────────────────────────────────────────────────

interface ListReadingsQuery {
  cefrLevel?: string;
  topicId?: number;
  withoutTopic?: boolean;
  type?: string;
  model?: string;
  isActive?: boolean;
  forBeginner?: boolean;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sort?: ReadingPassagesSort;
  page?: number;
  pageSize?: number;
}

function listReadings(query: ListReadingsQuery) {
  return readingPassageService.listPassages(query);
}

async function getReading(id: number) {
  const found = await readingPassageService.getById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy reading passage: ${id}`);
  return found;
}

interface UpdateReadingInput {
  title?: string;
  paragraphs?: string[];
  isActive?: boolean;
  forBeginner?: boolean;
}

function updateReading(id: number, input: UpdateReadingInput) {
  if (input.paragraphs !== undefined && input.paragraphs.filter((p) => p.trim().length > 0).length < 2) {
    throw new BusinessLogicException('Reading passage phải có ít nhất 2 đoạn văn');
  }
  logger.info(`[Admin] Update reading passage id=${id}`);
  return readingPassageService.updatePassage(id, input);
}

async function deleteReading(id: number) {
  logger.info(`[Admin] Delete reading passage id=${id}`);
  await readingPassageService.deletePassage(id);
  return { id, deleted: true };
}

function listReadingModels() {
  return readingPassageService.listPassageModels();
}

interface GenerateReadingPassageInput {
  topicName: string;
  cefrLevel: EngLevel;
  type: ReadingPassageType;
  model?: string;
  forBeginner?: boolean;
}

/** Sinh thử 1 bài để admin xem prompt/model cho ra gì — KHÔNG lưu vào kho. */
async function generateReadingPassage(input: GenerateReadingPassageInput) {
  const topicName = input.topicName.trim();
  if (!topicName) throw new BusinessLogicException('topicName không được để trống');

  const ctx = await studyService.buildReadingPassageContext({
    cefrLevel: input.cefrLevel,
    topicName,
    type: input.type,
    model: input.model,
    forBeginner: input.forBeginner
  });
  logger.info(
    `[Admin] Generate reading passage preview cefrLevel=${ctx.cefrLevel} type=${ctx.type} forBeginner=${ctx.forBeginner} topic="${topicName}"`
  );

  const { passages, usage } = await studyService.generateReadingPassageBatch(ctx, { count: 1 });
  const passage = passages[0];
  if (!passage) {
    throw new BusinessLogicException(
      'Model không trả về bài đọc hợp lệ (sai độ dài hoặc thiếu đoạn). Thử lại hoặc đổi model.'
    );
  }
  return { passage: { ...passage, type: ctx.type }, usage };
}

interface ReadingBucketFilterInput {
  cefrLevels?: string[];
  topicIds?: number[];
  types?: string[];
  audience?: string;
}

function toReadingBucketFilter(input: ReadingBucketFilterInput | undefined): ReadingBucketFilter | undefined {
  if (!input) return undefined;

  const invalidLevels = input.cefrLevels?.filter((level) => !ENG_LEVELS.includes(level as never)) ?? [];
  if (invalidLevels.length > 0) throw new BusinessLogicException(`cefrLevel không hợp lệ: ${invalidLevels.join(', ')}`);

  const invalidTopicIds = input.topicIds?.filter((id) => !Number.isInteger(id)) ?? [];
  if (invalidTopicIds.length > 0)
    throw new BusinessLogicException(`topicId không hợp lệ: ${invalidTopicIds.join(', ')}`);

  const invalidTypes = input.types?.filter((type) => !READING_PASSAGE_TYPES.includes(type as never)) ?? [];
  if (invalidTypes.length > 0) throw new BusinessLogicException(`type không hợp lệ: ${invalidTypes.join(', ')}`);

  const filter: ReadingBucketFilter = {
    cefrLevels: input.cefrLevels as EngLevel[] | undefined,
    topicIds: input.topicIds,
    types: input.types as ReadingPassageType[] | undefined,
    audience: toBucketAudience(input.audience)
  };

  const hasAny = Object.values(filter).some((values) => values !== undefined && values.length > 0);
  return hasAny ? filter : undefined;
}

interface ListReadingBucketsQuery {
  cefrLevels?: string;
  topicIds?: string;
  types?: string;
  audience?: string;
  scope?: 'all' | 'deficient';
  countPerBucket?: number;
}

/** Preview: bucket nào sẽ được sinh với đúng bộ tham số này, và mỗi bucket bao nhiêu bài. */
async function listReadingBuckets(query: ListReadingBucketsQuery) {
  const topicIds = parseCsvParam(query.topicIds)?.map((id) => Number(id));
  const filter = toReadingBucketFilter({
    cefrLevels: parseCsvParam(query.cefrLevels),
    topicIds,
    types: parseCsvParam(query.types),
    audience: query.audience
  });

  const { matched, plan } = await readingRefillService.buildManualReadingRefillPlan({
    scope: query.scope,
    countPerBucket: query.countPerBucket,
    filter
  });

  const plannedByKey = new Map(plan.planned.map((item) => [readingBucketKeyOf(item), item.count]));

  return {
    buckets: matched.map((candidate) => ({
      bucketKey: readingBucketKeyOf(candidate),
      cefrLevel: candidate.cefrLevel,
      topicId: candidate.topicId,
      topicName: candidate.topicName,
      type: candidate.type,
      forBeginner: candidate.forBeginner,
      currentCount: candidate.currentCount,
      deficiency: candidate.deficiency,
      plannedCount: plannedByKey.get(readingBucketKeyOf(candidate)) ?? 0
    })),
    summary: {
      matchedBuckets: matched.length,
      plannedBuckets: plan.planned.length,
      plannedPassages: plan.planned.reduce((sum, item) => sum + item.count, 0),
      maxPerBucket: readingPassageService.getMaxPerBucket()
    }
  };
}

interface TriggerReadingRefillInput {
  models?: string[];
  countPerBucket?: number;
  scope?: 'all' | 'deficient';
  filter?: ReadingBucketFilterInput;
  bucketKeys?: string[];
}

async function triggerReadingRefill(input: TriggerReadingRefillInput) {
  const models = await resolveStudyModels('reading', input.models);
  const filter = toReadingBucketFilter(input.filter);

  logger.info(
    `[Admin] Manual reading refill scope=${input.scope ?? 'all'} models=${models.map((m) => m.model).join(',')} ` +
      `countPerBucket=${input.countPerBucket ?? '-'} filter=${filter ? JSON.stringify(filter) : '-'} ` +
      `selectedBuckets=${input.bucketKeys?.length ?? '-'}`
  );

  return readingRefillService.runManualReadingRefill({
    models,
    countPerBucket: input.countPerBucket,
    scope: input.scope,
    filter,
    bucketKeys: input.bucketKeys
  });
}

// ─── Reading questions ──────────────────────────────────────────────────────────

interface ListReadingQuestionsQuery {
  passageId?: number;
  cefrLevel?: string;
  topicId?: number;
  withoutTopic?: boolean;
  type?: string;
  quizType?: string;
  model?: string;
  isActive?: boolean;
  forBeginner?: boolean;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sort?: ReadingQuestionsSort;
  page?: number;
  pageSize?: number;
}

function listReadingQuestions(query: ListReadingQuestionsQuery) {
  return readingQuestionService.listQuestions(query);
}

async function getReadingQuestion(id: number) {
  const found = await readingQuestionService.getById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy reading question: ${id}`);
  return found;
}

function updateReadingQuestion(id: number, input: UpdateReadingQuestionInput) {
  logger.info(`[Admin] Update reading question id=${id}`);
  return readingQuestionService.updateQuestion(id, input);
}

async function deleteReadingQuestion(id: number) {
  logger.info(`[Admin] Delete reading question id=${id}`);
  await readingQuestionService.deleteQuestion(id);
  return { id, deleted: true };
}

function listReadingQuestionModels() {
  return readingQuestionService.listQuestionModels();
}

/** Sinh thử trọn bộ câu hỏi cho 1 bài để admin xem prompt/model cho ra gì — KHÔNG lưu. */
async function generateReadingQuestions(input: { passageId: number; model?: string }) {
  const passage = await readingPassageService.getById(input.passageId);
  if (!passage) throw new NotFoundException(`Không tìm thấy reading passage: ${input.passageId}`);
  if (!passage.topicName) {
    throw new BusinessLogicException('Bài đọc không có topicName — prompt sinh câu hỏi cần thông tin này.');
  }

  const ctx = await studyService.buildReadingQuestionContext({ passage, model: input.model });
  logger.info(`[Admin] Generate reading questions preview passageId=${passage.id} model=${ctx.model}`);

  const count = getQuestionsPerPassage();
  const { questions, attempts } = await studyService.generateReadingQuestionSet(ctx, { count });
  if (questions.length === 0) {
    const failed = attempts.find((attempt) => !attempt.ok);
    throw new BusinessLogicException(
      `Model không sinh đủ ${count} câu hỏi hợp lệ` +
        (failed ? ` (hỏng ở loại "${failed.quizType}")` : '') +
        '. Bài đọc có thể thiếu dẫn chứng cho loại câu hỏi đó. Thử lại hoặc đổi model.'
    );
  }

  // Cộng token của tất cả các lần gọi — mỗi câu là một lần gọi riêng.
  const usage = attempts.reduce<{ inputTokens: number; outputTokens: number; model: string } | undefined>(
    (acc, attempt) => {
      if (!attempt.usage) return acc;
      if (!acc) return { ...attempt.usage };
      return {
        inputTokens: acc.inputTokens + attempt.usage.inputTokens,
        outputTokens: acc.outputTokens + attempt.usage.outputTokens,
        model: acc.model
      };
    },
    undefined
  );

  return {
    passage: {
      id: passage.id,
      title: passage.title,
      cefrLevel: passage.cefrLevel,
      topicName: passage.topicName
    },
    questions,
    usage
  };
}

interface ReadingQuestionBucketFilterInput {
  cefrLevels?: string[];
  topicIds?: number[];
  passageIds?: number[];
}

function toReadingQuestionBucketFilter(
  input: ReadingQuestionBucketFilterInput | undefined
): ReadingQuestionBucketFilter | undefined {
  if (!input) return undefined;

  const invalidLevels = input.cefrLevels?.filter((level) => !ENG_LEVELS.includes(level as never)) ?? [];
  if (invalidLevels.length > 0) throw new BusinessLogicException(`cefrLevel không hợp lệ: ${invalidLevels.join(', ')}`);

  const invalidTopicIds = input.topicIds?.filter((id) => !Number.isInteger(id)) ?? [];
  if (invalidTopicIds.length > 0)
    throw new BusinessLogicException(`topicId không hợp lệ: ${invalidTopicIds.join(', ')}`);

  const invalidPassageIds = input.passageIds?.filter((id) => !Number.isInteger(id)) ?? [];
  if (invalidPassageIds.length > 0)
    throw new BusinessLogicException(`passageId không hợp lệ: ${invalidPassageIds.join(', ')}`);

  const filter: ReadingQuestionBucketFilter = {
    cefrLevels: input.cefrLevels as EngLevel[] | undefined,
    topicIds: input.topicIds,
    passageIds: input.passageIds
  };

  const hasAny = Object.values(filter).some((values) => values !== undefined && values.length > 0);
  return hasAny ? filter : undefined;
}

interface ListReadingQuestionBucketsQuery {
  cefrLevels?: string;
  topicIds?: string;
  passageIds?: string;
  mode?: 'all' | 'deficient';
}

/** Preview: bài nào sẽ được sinh câu hỏi với đúng bộ tham số này, và mỗi bài bao nhiêu câu. */
async function listReadingQuestionBuckets(query: ListReadingQuestionBucketsQuery) {
  const filter = toReadingQuestionBucketFilter({
    cefrLevels: parseCsvParam(query.cefrLevels),
    topicIds: parseCsvParam(query.topicIds)?.map((id) => Number(id)),
    passageIds: parseCsvParam(query.passageIds)?.map((id) => Number(id))
  });

  const { matched, plan } = await readingQuestionRefillService.buildManualReadingQuestionRefillPlan({
    mode: query.mode,
    filter
  });

  const plannedByKey = new Map(plan.planned.map((item) => [readingQuestionBucketKeyOf(item.passageId), item.count]));

  return {
    buckets: matched.map((candidate) => ({
      bucketKey: readingQuestionBucketKeyOf(candidate.passageId),
      passageId: candidate.passageId,
      title: candidate.title,
      cefrLevel: candidate.cefrLevel,
      topicId: candidate.topicId,
      topicName: candidate.topicName,
      currentCount: candidate.currentCount,
      deficiency: candidate.deficiency,
      plannedCount: plannedByKey.get(readingQuestionBucketKeyOf(candidate.passageId)) ?? 0
    })),
    summary: {
      matchedPassages: matched.length,
      plannedPassages: plan.planned.length,
      plannedQuestions: plan.planned.reduce((sum, item) => sum + item.count, 0),
      questionsPerPassage: getQuestionsPerPassage()
    }
  };
}

interface TriggerReadingQuestionRefillInput {
  models?: string[];
  mode?: 'all' | 'deficient';
  filter?: ReadingQuestionBucketFilterInput;
  bucketKeys?: string[];
}

async function triggerReadingQuestionRefill(input: TriggerReadingQuestionRefillInput) {
  const models = await resolveStudyModels('reading', input.models);
  const filter = toReadingQuestionBucketFilter(input.filter);

  logger.info(
    `[Admin] Manual reading question refill mode=${input.mode ?? 'deficient'} ` +
      `models=${models.map((m) => m.model).join(',')} filter=${filter ? JSON.stringify(filter) : '-'} ` +
      `selectedBuckets=${input.bucketKeys?.length ?? '-'}`
  );

  return readingQuestionRefillService.runManualReadingQuestionRefill({
    models,
    mode: input.mode,
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
  triggerManualPoolRefill,
  setPoolQuestionForBeginner,
  enqueuePoolReviews,
  listPoolReviews,
  getPoolReview,
  approvePoolReview,
  rejectPoolReview,
  deletePoolReview,
  generatePoolSiblings,
  listSiblingSupportedTypes,
  listPoolSiblingBuckets,
  triggerManualPoolSiblingRefill,
  listReadings,
  getReading,
  updateReading,
  deleteReading,
  listReadingModels,
  generateReadingPassage,
  listReadingBuckets,
  triggerReadingRefill,
  listReadingQuestions,
  getReadingQuestion,
  updateReadingQuestion,
  deleteReadingQuestion,
  listReadingQuestionModels,
  generateReadingQuestions,
  listReadingQuestionBuckets,
  triggerReadingQuestionRefill
};
