import { and, count, eq, isNull, sql } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { englishQuestionPool, type InsertEnglishQuestionPool } from '@/core/db/schema/main';
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
  pushQuestions,
  clearPool,
  getMaxPoolSize,
  getRefillThreshold
};
