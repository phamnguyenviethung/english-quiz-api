import logger from '@/configs/logger.config';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { assertTopicAllowed, assertQuizTypeAllowed } from '@/api/plugins/tenantAuth.plugin';
import type { TenantContext } from '@/core/services/tenant/tenant.service';
import studyService, {
  type VocabQuestion,
  type PhraseQuestion,
  type FillBlankQuestion,
  type ConversationQuestion,
  type DescriptionQuestion,
  type SynonymQuestion,
  type SlangQuestion,
  type OddOneOutQuestion,
  type ParagraphQuestion,
  type IdiomQuestion,
  type VerbUseMatchQuestion,
  type StructuredOutputUsage
} from '@/core/services/english/study.service';
import questionPoolService, {
  pickQuizType,
  type ListPoolQuestionsInput
} from '@/core/services/english/questionPool.service';
import questionPoolTriggerService from '@/core/services/english/questionPoolTrigger.service';
import readingQuestionService from '@/core/services/english/readingQuestion.service';
import topicService from '@/core/services/english/topic.service';
import englishCronJobTrackingService from '@/core/services/english/englishCronJobTracking.service';
import {
  getEnglishConfigSnapshot,
  getAllEnglishConfigRows,
  updateEnglishConfig,
  updateEnglishConfigBulk,
  resetEnglishConfigToDefault,
  type EnglishConfigChange
} from '@/core/services/english/englishConfig.service';
import { QUIZ_TYPES, type EngLevel, type QuizType } from '@/core/services/english/questionTypes';

// ─── Generation ───────────────────────────────────────────────────────────────

interface GenerateInput {
  engLevel: EngLevel;
  optionCount: 3 | 4 | 5;
  topic?: string;
  model?: string;
  excludeWords?: string[];
}

// generateByType() switch-narrows quizType↔question nội bộ nhưng type đó không thoát ra
// ngoài function boundary (return type của nó chỉ là union rời của các { question }, còn
// quizType param ở đây vẫn giữ nguyên full QuizType union) — nên `{ quizType, ...result }`
// không tự nhiên khớp discriminated union theo quizType. Cast sang GenerateResult để
// OpenAPI response schema (GenerateQuestionResponseSchema) có thể model chính xác theo
// từng loại — không đổi giá trị trả về lúc runtime, chỉ khai báo type đúng với thực tế
// (generateByType luôn trả question đúng shape của quizType được truyền vào).
type GenerateResult =
  | { quizType: 'vocab'; question: VocabQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'phrase'; question: PhraseQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'fillblank'; question: FillBlankQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'conversation'; question: ConversationQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'description'; question: DescriptionQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'synonym'; question: SynonymQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'slang'; question: SlangQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'odd-one-out'; question: OddOneOutQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'paragraph'; question: ParagraphQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'idiom'; question: IdiomQuestion; usage?: StructuredOutputUsage }
  | { quizType: 'verb-use-match'; question: VerbUseMatchQuestion; usage?: StructuredOutputUsage };

async function generate(tenant: TenantContext, quizType: QuizType, input: GenerateInput): Promise<GenerateResult> {
  assertQuizTypeAllowed(tenant, quizType);
  const ctx = await studyService.buildContext({
    engLevel: input.engLevel,
    optionCount: input.optionCount,
    topicName: input.topic ?? null,
    model: input.model
  });
  logger.info(`[API] Generate ${quizType} engLevel=${ctx.engLevel} optionCount=${ctx.optionCount}`);
  const result = await studyService.generateByType(quizType, ctx, input.excludeWords);
  return { quizType, ...result } as GenerateResult;
}

interface GenerateReadingInput {
  engLevel: EngLevel;
  optionCount: 3 | 4 | 5;
  model?: string;
}

async function generateReading(input: GenerateReadingInput) {
  const ctx = await studyService.buildContext({
    engLevel: input.engLevel,
    optionCount: input.optionCount,
    model: input.model
  });
  logger.info(`[API] Generate reading engLevel=${ctx.engLevel} optionCount=${ctx.optionCount}`);
  return { quizType: 'reading' as const, ...(await studyService.generateReadingQuestion(ctx)) };
}

// ─── Question pool ──────────────────────────────────────────────────────────────

// Số id tối đa nhận qua `excludeIds`. Chặn query string phình to — client nào cần loại
// nhiều hơn thì gửi phần gần đây nhất.
const MAX_EXCLUDE_IDS = 200;

// CSV → number[]. Phần tử không phải số nguyên dương bị bỏ qua thay vì throw: đây là
// filter "best effort", input rác chỉ làm mất tác dụng lọc chứ không nên làm hỏng request.
export function parseExcludeIds(raw: string | undefined): number[] {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, MAX_EXCLUDE_IDS);
}

async function popFromPool(tenant: TenantContext, engLevel: EngLevel, topicId: number | null, excludeIds: number[]) {
  assertTopicAllowed(tenant, topicId);
  const question = await questionPoolService.popQuestion(engLevel, topicId, excludeIds);
  if (!question) throw new NotFoundException('Pool trống cho bucket này');
  return question;
}

async function countPool(tenant: TenantContext, engLevel: EngLevel, quizType: QuizType, topicId: number | null) {
  assertTopicAllowed(tenant, topicId);
  assertQuizTypeAllowed(tenant, quizType);
  const count = await questionPoolService.getPoolCount(engLevel, quizType, topicId);
  return { engLevel, quizType, topicId, count };
}

async function listPoolQuestions(tenant: TenantContext, input: ListPoolQuestionsInput) {
  if (input.withoutTopic) assertTopicAllowed(tenant, null);
  else if (input.topicId !== undefined) assertTopicAllowed(tenant, input.topicId);
  if (input.quizType) assertQuizTypeAllowed(tenant, input.quizType);
  return questionPoolService.listQuestions(input);
}

// Không lọc theo allow-list của tenant: đây chỉ là danh sách model để đổ dropdown filter,
// không lộ nội dung câu hỏi của topic/quizType ngoài phạm vi tenant.
function listPoolModels() {
  return questionPoolService.listPoolModels();
}

interface FillPoolInput {
  engLevel: EngLevel;
  quizType: QuizType;
  optionCount: 4 | 5;
  topicId?: number | null;
  topicName?: string | null;
}

async function fillPool(tenant: TenantContext, input: FillPoolInput) {
  const topicId = input.topicId ?? null;
  assertTopicAllowed(tenant, topicId);
  assertQuizTypeAllowed(tenant, input.quizType);
  await questionPoolTriggerService.ensurePoolFilled(
    input.engLevel,
    topicId,
    input.topicName ?? null,
    input.quizType,
    input.optionCount
  );
  return { enqueued: true };
}

function pickPoolQuizType() {
  return { quizType: pickQuizType() };
}

// ─── Meta ─────────────────────────────────────────────────────────────────────

function listQuizTypes() {
  return QUIZ_TYPES;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfigSnapshot() {
  return getEnglishConfigSnapshot();
}

function getConfigRecords() {
  return getAllEnglishConfigRows();
}

function updateConfig(recordKey: string, value: unknown) {
  return updateEnglishConfig(recordKey, value);
}

function updateConfigBulk(changes: EnglishConfigChange[]) {
  return updateEnglishConfigBulk(changes);
}

function resetConfig(recordKey: string) {
  return resetEnglishConfigToDefault(recordKey);
}

// ─── Topics ───────────────────────────────────────────────────────────────────

function listTopics() {
  return topicService.getAllActiveTopics();
}

function randomTopicPairs(pairCount: number) {
  return topicService.getRandomTopicPairs(pairCount, []);
}

function createTopic(name: string, description?: string) {
  return topicService.createTopic(name, description);
}

// ─── Cron tracking ──────────────────────────────────────────────────────────────

function listCronRuns(limit: number) {
  return englishCronJobTrackingService.getRecentRuns(limit);
}

async function getCronRun(runId: string) {
  const detail = await englishCronJobTrackingService.getRunDetail(runId);
  if (!detail) throw new NotFoundException('Không tìm thấy run');
  return detail;
}

interface CronUsageInput {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'model';
}

// Mặc định 30 ngày gần nhất khi không truyền khoảng thời gian.
function getCronUsage(input: CronUsageInput) {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BusinessLogicException('`from`/`to` không phải ngày hợp lệ (ISO 8601)');
  }
  if (from > to) throw new BusinessLogicException('`from` phải nhỏ hơn hoặc bằng `to`');

  return englishCronJobTrackingService.getUsageAnalytics({ from, to, groupBy: input.groupBy ?? 'day' });
}

// ─── Reading (bài đọc + câu hỏi) ──────────────────────────────────────────────

/**
 * Bài đọc luôn gắn 1 topic (không có bucket no-topic như question pool), nên khi client
 * không chỉ định topicId thì "mọi topic" phải được bó theo allow-list của tenant —
 * assertTopicAllowed(tenant, null) một mình không đủ để chặn.
 */
function resolveAllowedTopicIds(tenant: TenantContext): number[] | null {
  return tenant.allowAllTopics ? null : tenant.allowedTopicIds;
}

async function popReading(
  tenant: TenantContext,
  input: { cefrLevel?: EngLevel; topicId?: number; excludeIds: number[] }
) {
  if (input.topicId !== undefined) assertTopicAllowed(tenant, input.topicId);

  const result = await readingQuestionService.popPassageWithQuestions({
    cefrLevel: input.cefrLevel,
    topicId: input.topicId,
    excludeIds: input.excludeIds,
    allowedTopicIds: resolveAllowedTopicIds(tenant)
  });
  if (!result) throw new NotFoundException('Không có bài đọc nào đã sẵn sàng (đủ câu hỏi) cho bucket này');
  return result;
}

async function countReadings(tenant: TenantContext, input: { cefrLevel?: EngLevel; topicId?: number }) {
  if (input.topicId !== undefined) assertTopicAllowed(tenant, input.topicId);

  const count = await readingQuestionService.countReadyPassages({
    cefrLevel: input.cefrLevel,
    topicId: input.topicId,
    allowedTopicIds: resolveAllowedTopicIds(tenant)
  });
  return { cefrLevel: input.cefrLevel ?? null, topicId: input.topicId ?? null, count };
}

export default {
  generate,
  generateReading,
  popReading,
  countReadings,
  parseExcludeIds,
  popFromPool,
  countPool,
  listPoolQuestions,
  listPoolModels,
  fillPool,
  pickPoolQuizType,
  listQuizTypes,
  getConfigSnapshot,
  getConfigRecords,
  updateConfig,
  updateConfigBulk,
  resetConfig,
  listTopics,
  randomTopicPairs,
  createTopic,
  listCronRuns,
  getCronRun,
  getCronUsage
};
