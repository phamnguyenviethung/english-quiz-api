import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
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
  sourceQuestionId: number | null;
}

export interface PoolQuestionListItem extends PoolQuestion {
  engLevel: string;
  topicName: string | null;
  createdAt: Date | null;
}

export type PoolQuestionsSort = 'id_asc' | 'id_desc' | 'created_asc' | 'created_desc' | 'token_asc' | 'token_desc';

export const POOL_QUESTIONS_SORTS: PoolQuestionsSort[] = [
  'id_asc',
  'id_desc',
  'created_asc',
  'created_desc',
  'token_asc',
  'token_desc'
];

export interface ListPoolQuestionsInput {
  engLevel?: string;
  quizType?: QuizType;
  topicId?: number;
  withoutTopic?: boolean;
  model?: string;
  optionCount?: number;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  // Chỉ lấy câu sinh ra từ một câu gốc cụ thể (sibling của #id).
  sourceQuestionId?: number;
  // Chỉ lấy câu là sibling (sourceQuestionId IS NOT NULL).
  onlySiblings?: boolean;
  sort?: PoolQuestionsSort;
  page?: number;
  pageSize?: number;
}

export interface PoolModelStat {
  model: string;
  count: number;
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
  // Trỏ về câu pool gốc khi đây là một câu tương tự (sibling). Xem sibling-question.md.
  sourceQuestionId?: number | null;
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
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Danh sách model đang có câu trong pool + số lượng, dùng đổ dropdown filter ở admin UI. */
async function listPoolModels(): Promise<PoolModelStat[]> {
  const rows = await db
    .select({ model: englishQuestionPool.model, total: count() })
    .from(englishQuestionPool)
    .groupBy(englishQuestionPool.model)
    .orderBy(desc(count()), asc(englishQuestionPool.model));

  return rows.map((row) => ({ model: row.model, count: row.total }));
}

/**
 * Count của MỌI bucket trong 1 query, key = `${engLevel}:${topicId ?? 'null'}:${quizType}`
 * (khớp bucketKeyOf ở poolRefill.service). Dùng cho scan bucket — gọi getPoolCount lần lượt
 * cho từng bucket là hàng nghìn round-trip khi số topic lớn.
 */
async function getPoolCountsByBucket(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      engLevel: englishQuestionPool.engLevel,
      quizType: englishQuestionPool.quizType,
      topicId: englishQuestionPool.topicId,
      total: count()
    })
    .from(englishQuestionPool)
    .groupBy(englishQuestionPool.engLevel, englishQuestionPool.quizType, englishQuestionPool.topicId);

  return new Map(rows.map((row) => [`${row.engLevel}:${row.topicId ?? 'null'}:${row.quizType}`, row.total]));
}

/**
 * Count câu GỐC (`sourceQuestionId IS NULL`) mỗi bucket trong 1 query, key khớp `bucketKeyOf`.
 * Dùng cho preview manual sibling refill — biết mỗi bucket có bao nhiêu câu để làm nguồn sinh sibling.
 */
async function getSiblingSourceCountsByBucket(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      engLevel: englishQuestionPool.engLevel,
      quizType: englishQuestionPool.quizType,
      topicId: englishQuestionPool.topicId,
      total: count()
    })
    .from(englishQuestionPool)
    .where(isNull(englishQuestionPool.sourceQuestionId))
    .groupBy(englishQuestionPool.engLevel, englishQuestionPool.quizType, englishQuestionPool.topicId);

  return new Map(rows.map((row) => [`${row.engLevel}:${row.topicId ?? 'null'}:${row.quizType}`, row.total]));
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
    topicId: row.topicId,
    sourceQuestionId: row.sourceQuestionId
  };
}

/**
 * Lấy 1 câu random trong bucket (engLevel, topicId). Câu KHÔNG bị xóa/đánh dấu,
 * nên có thể được trả lại ở các lần pop sau — pool là kho câu hỏi dùng lại được.
 */
/**
 * Lấy 1 câu ngẫu nhiên trong bucket (engLevel, topicId). Không mutate row — pool là kho
 * dùng lại được, câu vẫn nằm lại sau khi pop.
 *
 * `excludeIds` để client tự chống lặp câu theo từng end-user (pool không biết end-user là
 * ai). Loại hết câu trong bucket → trả null, caller tự quyết định có pop lại không kèm
 * exclude hay không.
 */
/**
 * `allowedQuizTypes` = allow-list quizType của tenant (null = không giới hạn). Pop không nhận
 * quizType cụ thể nên không assert 403 được — phải lọc kết quả, giống /topics.
 */
async function popQuestion(
  engLevel: string,
  topicId: number | null = null,
  excludeIds: number[] = [],
  allowedQuizTypes: readonly string[] | null = null
): Promise<PoolQuestion | null> {
  if (allowedQuizTypes !== null && allowedQuizTypes.length === 0) return null;

  const conditions = [eq(englishQuestionPool.engLevel, engLevel), buildTopicCondition(topicId)];
  if (excludeIds.length > 0) conditions.push(notInArray(englishQuestionPool.id, excludeIds));
  if (allowedQuizTypes !== null) conditions.push(inArray(englishQuestionPool.quizType, [...allowedQuizTypes]));

  const [row] = await db
    .select()
    .from(englishQuestionPool)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (!row) return null;

  logger.info(
    `[QuestionPool] Popped question id=${row.id} type=${row.quizType} model=${row.model} engLevel=${engLevel} topicId=${topicId} excluded=${excludeIds.length}`
  );
  return mapRowToPoolQuestion(row);
}

/**
 * Lấy 1 câu theo id kèm engLevel + topicName (leftJoin english_topics). Dùng cho
 * luồng AI review — cần full context của item để dựng prompt review.
 */
async function getPoolQuestionById(id: number): Promise<PoolQuestionListItem | null> {
  const [row] = await db
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
      sourceQuestionId: englishQuestionPool.sourceQuestionId,
      topicDisplayName: englishTopic.displayName,
      topicRawName: englishTopic.name,
      createdAt: englishQuestionPool.createdAt
    })
    .from(englishQuestionPool)
    .leftJoin(englishTopic, eq(englishQuestionPool.topicId, englishTopic.id))
    .where(eq(englishQuestionPool.id, id))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    quizType: row.quizType as QuizType,
    engLevel: row.engLevel,
    questionData: row.questionData,
    model: row.model,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    optionCount: row.optionCount,
    topicId: row.topicId,
    sourceQuestionId: row.sourceQuestionId,
    topicName: row.topicDisplayName ?? row.topicRawName ?? null,
    createdAt: row.createdAt
  };
}

const totalTokenExpr = sql`${englishQuestionPool.tokenIn} + ${englishQuestionPool.tokenOut}`;

// createdAt/token không unique nên tie-break bằng id, nếu không phân trang có thể trùng/sót row.
const ORDER_BY_CLAUSES: Record<PoolQuestionsSort, SQL[]> = {
  id_asc: [asc(englishQuestionPool.id)],
  id_desc: [desc(englishQuestionPool.id)],
  created_asc: [asc(englishQuestionPool.createdAt), asc(englishQuestionPool.id)],
  created_desc: [desc(englishQuestionPool.createdAt), desc(englishQuestionPool.id)],
  token_asc: [asc(totalTokenExpr), asc(englishQuestionPool.id)],
  token_desc: [desc(totalTokenExpr), desc(englishQuestionPool.id)]
};

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
  if (input.optionCount !== undefined) conditions.push(eq(englishQuestionPool.optionCount, input.optionCount));
  if (input.withoutTopic) conditions.push(buildTopicCondition(null));
  else if (input.topicId !== undefined) conditions.push(buildTopicCondition(input.topicId));

  // sourceQuestionId thắng onlySiblings (trỏ đúng một câu gốc thì hiển nhiên là sibling).
  if (input.sourceQuestionId !== undefined) {
    conditions.push(eq(englishQuestionPool.sourceQuestionId, input.sourceQuestionId));
  } else if (input.onlySiblings) {
    conditions.push(isNotNull(englishQuestionPool.sourceQuestionId));
  }

  // createdAt nullable — row cũ chưa có createdAt sẽ bị loại khi lọc theo khoảng ngày.
  if (input.createdFrom) conditions.push(gte(englishQuestionPool.createdAt, new Date(input.createdFrom)));
  if (input.createdTo) conditions.push(lte(englishQuestionPool.createdAt, new Date(input.createdTo)));

  const keyword = input.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    const matches = [ilike(englishQuestionPool.questionData, pattern), ilike(englishQuestionPool.model, pattern)];
    // Gõ toàn số: có thể là ID hoặc một con số trong nội dung câu hỏi — giữ cả hai nhánh.
    if (/^\d+$/.test(keyword)) matches.push(eq(englishQuestionPool.id, Number(keyword)));
    conditions.push(or(...matches)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = ORDER_BY_CLAUSES[input.sort ?? 'id_asc'] ?? ORDER_BY_CLAUSES.id_asc;

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
        sourceQuestionId: englishQuestionPool.sourceQuestionId,
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
    sourceQuestionId: row.sourceQuestionId,
    topicName: row.topicDisplayName ?? row.topicRawName ?? null,
    createdAt: row.createdAt
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Chọn ngẫu nhiên tối đa `limit` câu gốc (KHÔNG phải sibling) trong bucket để job auto
 * dùng làm nguồn sinh câu tương tự. Chỉ lấy câu `sourceQuestionId IS NULL` để không sinh
 * sibling từ sibling (giữ chất lượng gần câu gốc thật).
 */
async function pickSiblingSourceIds(
  engLevel: string,
  quizType: QuizType,
  topicId: number | null,
  limit: number
): Promise<number[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ id: englishQuestionPool.id })
    .from(englishQuestionPool)
    .where(
      and(
        eq(englishQuestionPool.engLevel, engLevel),
        eq(englishQuestionPool.quizType, quizType),
        buildTopicCondition(topicId),
        isNull(englishQuestionPool.sourceQuestionId)
      )
    )
    .orderBy(sql`RANDOM()`)
    .limit(limit);
  return rows.map((row) => row.id);
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
        topicId: q.topicId ?? null,
        sourceQuestionId: q.sourceQuestionId ?? null
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
  getPoolCountsByBucket,
  getSiblingSourceCountsByBucket,
  getPoolQuestionById,
  popQuestion,
  listQuestions,
  listPoolModels,
  pushQuestions,
  pickSiblingSourceIds,
  clearPool,
  getMaxPoolSize,
  getRefillThreshold,
  getPerBucketGenerationCap
};
