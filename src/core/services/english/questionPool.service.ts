import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { englishQuestionPool, englishTopic, type InsertEnglishQuestionPool } from '@/core/db/schema/main';
import type { DifficultyContext } from './study.service';
import random from '@/utils/chance';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import type { QuizType } from './questionTypes';

export interface PoolQuestion {
  id: number;
  quizType: QuizType;
  questionData: string;
  model: string;
  tokenIn: number;
  tokenOut: number;
  optionCount: number;
  topicId: number | null;
}

export interface PoolQuestionListItem extends PoolQuestion {
  engLevel: string;
  topicName: string | null;
  createdAt: Date | null;
}

export interface ListPoolQuestionsInput {
  engLevel?: string;
  quizType?: QuizType;
  topicId?: number;
  withoutTopic?: boolean;
  model?: string;
  q?: string;
  sort?: 'id_asc' | 'id_desc';
  page?: number;
  pageSize?: number;
}

export interface PoolQuestionPage {
  items: PoolQuestionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const LIST_QUESTIONS_DEFAULT_PAGE_SIZE = 20;
export const LIST_QUESTIONS_MAX_PAGE_SIZE = 100;

export interface PushQuestionInput {
  quizType: QuizType;
  engLevel: string;
  optionCount: number;
  questionData: string;
  model: string;
  tokenIn: number;
  tokenOut: number;
  topicId?: number | null;
}

export function getMaxPoolSize(): number {
  return getEnglishConfigSnapshot().question_pool.maxPerBucket;
}

export function getRefillThreshold(): number {
  const config = getEnglishConfigSnapshot().question_pool;
  return Math.ceil(config.maxPerBucket * config.refillThresholdRatio);
}

export function getPerBucketGenerationCap(): number {
  return getEnglishConfigSnapshot().question_pool.perBucketGenerationCap;
}

export function pickQuizType(): QuizType {
  const enabledItems = getEnglishConfigSnapshot().quiz_distribution.filter((item) => item.enabled && item.weight > 0);
  const totalWeight = enabledItems.reduce((sum, item) => sum + item.weight, 0);
  const distribution = enabledItems.map((item) => ({
    percentage: (item.weight / totalWeight) * 100,
    value: item.quizType as QuizType
  }));
  return random<QuizType>(distribution);
}

function buildTopicCondition(topicId: number | null) {
  return topicId !== null ? eq(englishQuestionPool.topicId, topicId) : isNull(englishQuestionPool.topicId);
}

// drizzle ilike() không tự escape — % và _ gõ bởi người dùng phải escape thủ công,
// nếu không chúng sẽ hoạt động như wildcard SQL (vd: q="%" sẽ khớp toàn bộ bảng).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function getPoolCount(engLevel: string, quizType: QuizType, topicId: number | null = null): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(englishQuestionPool)
    .where(
      and(
        eq(englishQuestionPool.engLevel, engLevel),
        eq(englishQuestionPool.quizType, quizType),
        buildTopicCondition(topicId)
      )
    );
  return result?.total ?? 0;
}

function mapRowToPoolQuestion(row: typeof englishQuestionPool.$inferSelect): PoolQuestion {
  return {
    id: row.id,
    quizType: row.quizType as QuizType,
    questionData: row.questionData,
    model: row.model,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    optionCount: row.optionCount,
    topicId: row.topicId
  };
}

/**
 * Lấy 1 câu random trong bucket (engLevel, topicId). Câu KHÔNG bị xóa/đánh dấu,
 * nên có thể được trả lại ở các lần pop sau — pool là kho câu hỏi dùng lại được.
 */
async function popQuestion(engLevel: string, topicId: number | null = null): Promise<PoolQuestion | null> {
  const [row] = await db
    .select()
    .from(englishQuestionPool)
    .where(and(eq(englishQuestionPool.engLevel, engLevel), buildTopicCondition(topicId)))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (!row) return null;

  logger.info(
    `[QuestionPool] Popped question id=${row.id} type=${row.quizType} model=${row.model} engLevel=${engLevel} topicId=${topicId}`
  );
  return mapRowToPoolQuestion(row);
}

/**
 * List câu hỏi trong pool có filter + phân trang, phục vụ admin UI.
 * `withoutTopic` thắng `topicId` khi truyền cả hai: bucket không topic là một bucket riêng
 * (topicId IS NULL), không phải tập con của bất kỳ topicId nào.
 */
async function listQuestions(input: ListPoolQuestionsInput): Promise<PoolQuestionPage> {
  const pageSize = Math.min(
    Math.max(1, input.pageSize ?? LIST_QUESTIONS_DEFAULT_PAGE_SIZE),
    LIST_QUESTIONS_MAX_PAGE_SIZE
  );
  const page = Math.max(1, input.page ?? 1);

  const conditions = [];
  if (input.engLevel) conditions.push(eq(englishQuestionPool.engLevel, input.engLevel));
  if (input.quizType) conditions.push(eq(englishQuestionPool.quizType, input.quizType));
  if (input.model) conditions.push(eq(englishQuestionPool.model, input.model));
  if (input.withoutTopic) conditions.push(buildTopicCondition(null));
  else if (input.topicId !== undefined) conditions.push(buildTopicCondition(input.topicId));

  const keyword = input.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    const matches = [ilike(englishQuestionPool.questionData, pattern), ilike(englishQuestionPool.model, pattern)];
    // Gõ toàn số: có thể là ID hoặc một con số trong nội dung câu hỏi — giữ cả hai nhánh.
    if (/^\d+$/.test(keyword)) matches.push(eq(englishQuestionPool.id, Number(keyword)));
    conditions.push(or(...matches)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = input.sort === 'id_desc' ? [desc(englishQuestionPool.id)] : [asc(englishQuestionPool.id)];

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: englishQuestionPool.id,
        quizType: englishQuestionPool.quizType,
        engLevel: englishQuestionPool.engLevel,
        optionCount: englishQuestionPool.optionCount,
        questionData: englishQuestionPool.questionData,
        model: englishQuestionPool.model,
        tokenIn: englishQuestionPool.tokenIn,
        tokenOut: englishQuestionPool.tokenOut,
        topicId: englishQuestionPool.topicId,
        topicDisplayName: englishTopic.displayName,
        topicRawName: englishTopic.name,
        createdAt: englishQuestionPool.createdAt
      })
      .from(englishQuestionPool)
      .leftJoin(englishTopic, eq(englishQuestionPool.topicId, englishTopic.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(englishQuestionPool).where(whereClause)
  ]);

  const total = totalRow?.total ?? 0;
  const items: PoolQuestionListItem[] = rows.map((row) => ({
    id: row.id,
    quizType: row.quizType as QuizType,
    engLevel: row.engLevel,
    questionData: row.questionData,
    model: row.model,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    optionCount: row.optionCount,
    topicId: row.topicId,
    topicName: row.topicDisplayName ?? row.topicRawName ?? null,
    createdAt: row.createdAt
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function pushQuestions(questions: PushQuestionInput[]): Promise<number> {
  if (questions.length === 0) return 0;

  const inserted = await db.transaction(async (tx) => {
    const bucketKeys = [...new Set(questions.map((q) => `${q.engLevel}:${q.topicId ?? 'null'}:${q.quizType}`))];
    const bucketCounts = new Map<string, number>();
    let insertedCount = 0;

    for (const key of bucketKeys) {
      const [engLevel, topicIdStr, quizType] = key.split(':');
      const topicId = topicIdStr === 'null' ? null : Number(topicIdStr);
      const [result] = await tx
        .select({ total: count() })
        .from(englishQuestionPool)
        .where(
          and(
            eq(englishQuestionPool.engLevel, engLevel!),
            eq(englishQuestionPool.quizType, quizType!),
            buildTopicCondition(topicId)
          )
        );
      bucketCounts.set(key, result?.total ?? 0);
    }

    for (const q of questions) {
      const key = `${q.engLevel}:${q.topicId ?? 'null'}:${q.quizType}`;
      const currentCount = bucketCounts.get(key) ?? 0;

      const maxPool = getMaxPoolSize();
      if (currentCount >= maxPool) {
        logger.info(
          `[QuestionPool] Bucket full (${currentCount}/${maxPool}) for engLevel=${q.engLevel} topicId=${q.topicId} quizType=${q.quizType}, skipping`
        );
        continue;
      }

      const values: InsertEnglishQuestionPool = {
        quizType: q.quizType,
        engLevel: q.engLevel,
        optionCount: q.optionCount,
        questionData: q.questionData,
        model: q.model,
        tokenIn: q.tokenIn,
        tokenOut: q.tokenOut,
        topicId: q.topicId ?? null
      };

      await tx.insert(englishQuestionPool).values(values);
      bucketCounts.set(key, currentCount + 1);
      insertedCount++;
    }

    return insertedCount;
  });

  logger.info(`[QuestionPool] Pushed ${inserted}/${questions.length} question(s)`);
  return inserted;
}

async function clearPool(engLevel?: string, topicId?: number | null): Promise<void> {
  const conditions = [];
  if (engLevel !== undefined) conditions.push(eq(englishQuestionPool.engLevel, engLevel));
  if (topicId !== undefined) conditions.push(buildTopicCondition(topicId));

  if (conditions.length === 0) {
    await db.delete(englishQuestionPool);
  } else {
    await db.delete(englishQuestionPool).where(and(...conditions));
  }

  logger.info(`[QuestionPool] Cleared pool engLevel=${engLevel} topicId=${topicId}`);
}

export default {
  getPoolCount,
  popQuestion,
  listQuestions,
  pushQuestions,
  clearPool,
  getMaxPoolSize,
  getRefillThreshold,
  getPerBucketGenerationCap
};
