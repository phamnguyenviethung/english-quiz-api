import logger from '@/configs/logger.config';
import { NotFoundException } from '@/core/exceptions';
import { assertTopicAllowed, assertQuizTypeAllowed } from '@/api/plugins/tenantAuth.plugin';
import type { TenantContext } from '@/core/services/tenant/tenant.service';
import studyService from '@/core/services/english/study.service';
import questionPoolService, { pickQuizType } from '@/core/services/english/questionPool.service';
import questionPoolTriggerService from '@/core/services/english/questionPoolTrigger.service';
import topicService from '@/core/services/english/topic.service';
import englishCronJobTrackingService from '@/core/services/english/englishCronJobTracking.service';
import {
  getEnglishConfigSnapshot,
  getAllEnglishConfigRows,
  updateEnglishConfig,
  resetEnglishConfigToDefault
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

async function generate(tenant: TenantContext, quizType: QuizType, input: GenerateInput) {
  assertQuizTypeAllowed(tenant, quizType);
  const ctx = await studyService.buildContext({
    engLevel: input.engLevel,
    optionCount: input.optionCount,
    topicName: input.topic ?? null,
    model: input.model
  });
  logger.info(`[API] Generate ${quizType} engLevel=${ctx.engLevel} optionCount=${ctx.optionCount}`);
  const result = await studyService.generateByType(quizType, ctx, input.excludeWords);
  return { quizType, ...result };
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

async function popFromPool(tenant: TenantContext, engLevel: EngLevel, topicId: number | null) {
  assertTopicAllowed(tenant, topicId);
  const question = await questionPoolService.popQuestion(engLevel, topicId);
  if (!question) throw new NotFoundException('Pool trống cho bucket này');
  return question;
}

async function countPool(tenant: TenantContext, engLevel: EngLevel, quizType: QuizType, topicId: number | null) {
  assertTopicAllowed(tenant, topicId);
  assertQuizTypeAllowed(tenant, quizType);
  const count = await questionPoolService.getPoolCount(engLevel, quizType, topicId);
  return { engLevel, quizType, topicId, count };
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

export default {
  generate,
  generateReading,
  popFromPool,
  countPool,
  fillPool,
  pickPoolQuizType,
  listQuizTypes,
  getConfigSnapshot,
  getConfigRecords,
  updateConfig,
  resetConfig,
  listTopics,
  randomTopicPairs,
  createTopic,
  listCronRuns,
  getCronRun
};
