import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  englishReadingPassage,
  englishReadingQuestion,
  englishTopic,
  type InsertEnglishReadingPassage
} from '@/core/db/schema/main';
import { NotFoundException } from '@/core/exceptions';
import { countPassageWords } from './prompt/reading-passage-prompt';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import type { EngLevel, ReadingPassageType } from './questionTypes';

export interface ReadingPassageRecord {
  id: number;
  title: string;
  paragraphs: string[];
  wordCount: number;
  cefrLevel: string;
  topicId: number | null;
  topicName: string | null;
  type: string;
  model: string;
  tokenIn: number;
  tokenOut: number;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type ReadingPassagesSort = 'id_asc' | 'id_desc' | 'created_asc' | 'created_desc' | 'words_asc' | 'words_desc';

export const READING_PASSAGE_SORTS: ReadingPassagesSort[] = [
  'id_asc',
  'id_desc',
  'created_asc',
  'created_desc',
  'words_asc',
  'words_desc'
];

export interface ListReadingPassagesInput {
  cefrLevel?: string;
  topicId?: number;
  withoutTopic?: boolean;
  type?: string;
  model?: string;
  isActive?: boolean;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  sort?: ReadingPassagesSort;
  page?: number;
  pageSize?: number;
}

export interface ReadingPassagePage {
  items: ReadingPassageRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReadingPassageModelStat {
  model: string;
  count: number;
}

export interface InsertReadingPassageInput {
  title: string;
  paragraphs: string[];
  wordCount: number;
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  type: ReadingPassageType;
  model: string;
  tokenIn: number;
  tokenOut: number;
}

export const LIST_PASSAGES_DEFAULT_PAGE_SIZE = 20;
export const LIST_PASSAGES_MAX_PAGE_SIZE = 100;

export function getMaxPerBucket(): number {
  return getEnglishConfigSnapshot().reading_passage.maxPerBucket;
}

export function getRefillThreshold(): number {
  const config = getEnglishConfigSnapshot().reading_passage;
  return Math.ceil(config.maxPerBucket * config.refillThresholdRatio);
}

export function getPerBucketGenerationCap(): number {
  return getEnglishConfigSnapshot().reading_passage.perBucketGenerationCap;
}

export function getExcludeRecentTitleCount(): number {
  return getEnglishConfigSnapshot().reading_passage.excludeRecentTitleCount;
}

function buildTopicCondition(topicId: number | null) {
  return topicId !== null ? eq(englishReadingPassage.topicId, topicId) : isNull(englishReadingPassage.topicId);
}

// drizzle ilike() không tự escape — giống questionPool.service, % và _ do người dùng gõ
// phải escape thủ công nếu không sẽ hoạt động như wildcard SQL.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function mapRow(row: {
  id: number;
  title: string;
  paragraphs: string[];
  wordCount: number;
  cefrLevel: string;
  topicId: number | null;
  topicName: string | null;
  type: string;
  model: string;
  tokenIn: number;
  tokenOut: number;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}): ReadingPassageRecord {
  return { ...row };
}

/**
 * Count của MỌI bucket trong 1 query, key = `${cefrLevel}:${topicId ?? 'null'}:${type}`
 * (khớp readingBucketKeyOf ở readingRefill.service). Chỉ đếm bài đang active — bài đã
 * tắt không phục vụ được nên không tính là "đã có".
 */
async function getCountsByBucket(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      cefrLevel: englishReadingPassage.cefrLevel,
      topicId: englishReadingPassage.topicId,
      type: englishReadingPassage.type,
      total: count()
    })
    .from(englishReadingPassage)
    .where(eq(englishReadingPassage.isActive, true))
    .groupBy(englishReadingPassage.cefrLevel, englishReadingPassage.topicId, englishReadingPassage.type);

  return new Map(rows.map((row) => [`${row.cefrLevel}:${row.topicId ?? 'null'}:${row.type}`, row.total]));
}

async function getCount(cefrLevel: string, topicId: number | null, type: string): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(englishReadingPassage)
    .where(
      and(
        eq(englishReadingPassage.cefrLevel, cefrLevel),
        buildTopicCondition(topicId),
        eq(englishReadingPassage.type, type),
        eq(englishReadingPassage.isActive, true)
      )
    );
  return result?.total ?? 0;
}

/** Title các bài gần nhất trong bucket — feed vào prompt để model không lặp plot. */
async function getRecentTitles(
  cefrLevel: string,
  topicId: number | null,
  type: string,
  limit: number
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ title: englishReadingPassage.title })
    .from(englishReadingPassage)
    .where(
      and(
        eq(englishReadingPassage.cefrLevel, cefrLevel),
        buildTopicCondition(topicId),
        eq(englishReadingPassage.type, type)
      )
    )
    .orderBy(desc(englishReadingPassage.id))
    .limit(limit);
  return rows.map((row) => row.title);
}

const ORDER_BY_CLAUSES: Record<ReadingPassagesSort, SQL[]> = {
  id_asc: [asc(englishReadingPassage.id)],
  id_desc: [desc(englishReadingPassage.id)],
  created_asc: [asc(englishReadingPassage.createdAt), asc(englishReadingPassage.id)],
  created_desc: [desc(englishReadingPassage.createdAt), desc(englishReadingPassage.id)],
  words_asc: [asc(englishReadingPassage.wordCount), asc(englishReadingPassage.id)],
  words_desc: [desc(englishReadingPassage.wordCount), desc(englishReadingPassage.id)]
};

const SELECT_COLUMNS = {
  id: englishReadingPassage.id,
  title: englishReadingPassage.title,
  paragraphs: englishReadingPassage.paragraphs,
  wordCount: englishReadingPassage.wordCount,
  cefrLevel: englishReadingPassage.cefrLevel,
  topicId: englishReadingPassage.topicId,
  topicName: englishReadingPassage.topicName,
  type: englishReadingPassage.type,
  model: englishReadingPassage.model,
  tokenIn: englishReadingPassage.tokenIn,
  tokenOut: englishReadingPassage.tokenOut,
  isActive: englishReadingPassage.isActive,
  createdAt: englishReadingPassage.createdAt,
  updatedAt: englishReadingPassage.updatedAt
};

/**
 * List có filter + phân trang cho admin UI. `withoutTopic` thắng `topicId` khi truyền
 * cả hai — bucket không topic là bucket riêng (topicId IS NULL), không phải tập con.
 */
async function listPassages(input: ListReadingPassagesInput): Promise<ReadingPassagePage> {
  const pageSize = Math.min(
    Math.max(1, input.pageSize ?? LIST_PASSAGES_DEFAULT_PAGE_SIZE),
    LIST_PASSAGES_MAX_PAGE_SIZE
  );
  const page = Math.max(1, input.page ?? 1);

  const conditions = [];
  if (input.cefrLevel) conditions.push(eq(englishReadingPassage.cefrLevel, input.cefrLevel));
  if (input.type) conditions.push(eq(englishReadingPassage.type, input.type));
  if (input.model) conditions.push(eq(englishReadingPassage.model, input.model));
  if (input.isActive !== undefined) conditions.push(eq(englishReadingPassage.isActive, input.isActive));
  if (input.withoutTopic) conditions.push(buildTopicCondition(null));
  else if (input.topicId !== undefined) conditions.push(buildTopicCondition(input.topicId));

  if (input.createdFrom) conditions.push(gte(englishReadingPassage.createdAt, new Date(input.createdFrom)));
  if (input.createdTo) conditions.push(lte(englishReadingPassage.createdAt, new Date(input.createdTo)));

  const keyword = input.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    const matches = [
      ilike(englishReadingPassage.title, pattern),
      ilike(englishReadingPassage.model, pattern),
      // paragraphs là jsonb → cast text để tìm trong nội dung bài.
      sql`${englishReadingPassage.paragraphs}::text ILIKE ${pattern}`
    ];
    if (/^\d+$/.test(keyword)) matches.push(eq(englishReadingPassage.id, Number(keyword)));
    conditions.push(or(...matches)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = ORDER_BY_CLAUSES[input.sort ?? 'id_desc'] ?? ORDER_BY_CLAUSES.id_desc;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(SELECT_COLUMNS)
      .from(englishReadingPassage)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(englishReadingPassage).where(whereClause)
  ]);

  const total = totalRow?.total ?? 0;
  return {
    items: rows.map(mapRow),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

async function getById(id: number): Promise<ReadingPassageRecord | null> {
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(englishReadingPassage)
    .where(eq(englishReadingPassage.id, id))
    .limit(1);
  return row ? mapRow(row) : null;
}

/** Model đang có bài trong kho + số lượng, dùng đổ dropdown filter ở admin UI. */
async function listPassageModels(): Promise<ReadingPassageModelStat[]> {
  const rows = await db
    .select({ model: englishReadingPassage.model, total: count() })
    .from(englishReadingPassage)
    .groupBy(englishReadingPassage.model)
    .orderBy(desc(count()), asc(englishReadingPassage.model));

  return rows.map((row) => ({ model: row.model, count: row.total }));
}

/**
 * Insert có cap theo maxPerBucket (giống questionPool.pushQuestions): batch có thể về
 * nhiều hơn chỗ trống nếu bucket vừa được fill song song, phần thừa bị bỏ chứ không
 * làm bucket phình quá target.
 */
async function insertPassages(passages: InsertReadingPassageInput[]): Promise<number> {
  if (passages.length === 0) return 0;

  const inserted = await db.transaction(async (tx) => {
    const bucketKeys = [...new Set(passages.map((p) => `${p.cefrLevel}:${p.topicId ?? 'null'}:${p.type}`))];
    const bucketCounts = new Map<string, number>();
    let insertedCount = 0;

    for (const key of bucketKeys) {
      const [cefrLevel, topicIdStr, type] = key.split(':');
      const topicId = topicIdStr === 'null' ? null : Number(topicIdStr);
      const [result] = await tx
        .select({ total: count() })
        .from(englishReadingPassage)
        .where(
          and(
            eq(englishReadingPassage.cefrLevel, cefrLevel!),
            buildTopicCondition(topicId),
            eq(englishReadingPassage.type, type!),
            eq(englishReadingPassage.isActive, true)
          )
        );
      bucketCounts.set(key, result?.total ?? 0);
    }

    const maxPerBucket = getMaxPerBucket();
    for (const passage of passages) {
      const key = `${passage.cefrLevel}:${passage.topicId ?? 'null'}:${passage.type}`;
      const currentCount = bucketCounts.get(key) ?? 0;

      if (currentCount >= maxPerBucket) {
        logger.info(
          `[ReadingPassage] Bucket full (${currentCount}/${maxPerBucket}) for cefrLevel=${passage.cefrLevel} topicId=${passage.topicId} type=${passage.type}, skipping`
        );
        continue;
      }

      const values: InsertEnglishReadingPassage = {
        title: passage.title,
        paragraphs: passage.paragraphs,
        wordCount: passage.wordCount,
        cefrLevel: passage.cefrLevel,
        topicId: passage.topicId,
        topicName: passage.topicName,
        type: passage.type,
        model: passage.model,
        tokenIn: passage.tokenIn,
        tokenOut: passage.tokenOut
      };

      await tx.insert(englishReadingPassage).values(values);
      bucketCounts.set(key, currentCount + 1);
      insertedCount++;
    }

    return insertedCount;
  });

  logger.info(`[ReadingPassage] Inserted ${inserted}/${passages.length} passage(s)`);
  return inserted;
}

export interface UpdateReadingPassageInput {
  title?: string;
  paragraphs?: string[];
  isActive?: boolean;
}

/**
 * Sửa paragraphs luôn kéo theo tính lại wordCount — không để 2 giá trị lệch nhau.
 *
 * Đổi nội dung đoạn văn cũng làm mọi câu hỏi đọc hiểu của bài thành sai: chúng neo vào
 * evidence trong đoạn cũ. Tắt (chứ không xoá) để admin còn xem lại, và scan sẽ tự thấy
 * bài thiếu câu rồi sinh lại. Reset luôn questionGenAttempts vì đây là bài "mới".
 */
async function updatePassage(id: number, patch: UpdateReadingPassageInput): Promise<ReadingPassageRecord> {
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: englishReadingPassage.id })
      .from(englishReadingPassage)
      .where(eq(englishReadingPassage.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Không tìm thấy reading passage: ${id}`);

    const paragraphs = patch.paragraphs?.map((paragraph) => paragraph.trim()).filter(Boolean);

    if (paragraphs) {
      const stale = await tx
        .update(englishReadingQuestion)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(englishReadingQuestion.passageRefId, id), eq(englishReadingQuestion.isActive, true)))
        .returning({ id: englishReadingQuestion.id });
      if (stale.length > 0) {
        logger.info(`[ReadingPassage] Deactivated ${stale.length} stale question(s) for passage id=${id}`);
      }
    }

    const [row] = await tx
      .update(englishReadingPassage)
      .set({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(paragraphs ? { paragraphs, wordCount: countPassageWords(paragraphs), questionGenAttempts: 0 } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: new Date()
      })
      .where(eq(englishReadingPassage.id, id))
      .returning(SELECT_COLUMNS);
    return row;
  });

  if (!updated) throw new NotFoundException(`Không tìm thấy reading passage: ${id}`);
  logger.info(`[ReadingPassage] Updated passage id=${id}`);
  return mapRow(updated);
}

async function deletePassage(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(englishReadingPassage)
      .where(eq(englishReadingPassage.id, id))
      .returning({ id: englishReadingPassage.id });
    if (!deleted) throw new NotFoundException(`Không tìm thấy reading passage: ${id}`);
  });
  logger.info(`[ReadingPassage] Deleted passage id=${id}`);
}

export interface QuestionGenCandidate {
  id: number;
  title: string;
  cefrLevel: string;
  topicId: number | null;
  topicName: string | null;
  questionGenAttempts: number;
}

export interface QuestionGenCandidateFilter {
  cefrLevels?: string[];
  topicIds?: number[];
  passageIds?: number[];
  maxAttempts?: number;
}

/**
 * Bài đủ điều kiện sinh câu hỏi: đang active và chưa vượt trần số lần sinh hỏng.
 * Bài quá mỏng model sinh mãi không nổi 3 câu — không chặn thì cron gọi lại vô hạn.
 */
async function listQuestionGenCandidates(filter: QuestionGenCandidateFilter = {}): Promise<QuestionGenCandidate[]> {
  const conditions = [eq(englishReadingPassage.isActive, true)];
  if (filter.maxAttempts !== undefined) {
    conditions.push(lt(englishReadingPassage.questionGenAttempts, filter.maxAttempts));
  }
  if (filter.cefrLevels && filter.cefrLevels.length > 0) {
    conditions.push(inArray(englishReadingPassage.cefrLevel, filter.cefrLevels));
  }
  if (filter.topicIds && filter.topicIds.length > 0) {
    conditions.push(inArray(englishReadingPassage.topicId, filter.topicIds));
  }
  if (filter.passageIds && filter.passageIds.length > 0) {
    conditions.push(inArray(englishReadingPassage.id, filter.passageIds));
  }

  return db
    .select({
      id: englishReadingPassage.id,
      title: englishReadingPassage.title,
      cefrLevel: englishReadingPassage.cefrLevel,
      topicId: englishReadingPassage.topicId,
      topicName: englishReadingPassage.topicName,
      questionGenAttempts: englishReadingPassage.questionGenAttempts
    })
    .from(englishReadingPassage)
    .where(and(...conditions))
    .orderBy(asc(englishReadingPassage.id));
}

async function incrementQuestionGenAttempts(id: number): Promise<void> {
  await db
    .update(englishReadingPassage)
    .set({ questionGenAttempts: sql`${englishReadingPassage.questionGenAttempts} + 1`, updatedAt: new Date() })
    .where(eq(englishReadingPassage.id, id));
}

async function resetQuestionGenAttempts(id: number): Promise<void> {
  await db
    .update(englishReadingPassage)
    .set({ questionGenAttempts: 0, updatedAt: new Date() })
    .where(eq(englishReadingPassage.id, id));
}

/** Topic đang active kèm số bài mỗi level — dùng cho stat ở dashboard. */
async function getTopicCoverage(): Promise<
  Array<{ topicId: number; topicName: string; cefrLevel: string; total: number }>
> {
  const rows = await db
    .select({
      topicId: englishReadingPassage.topicId,
      topicName: englishTopic.name,
      cefrLevel: englishReadingPassage.cefrLevel,
      total: count()
    })
    .from(englishReadingPassage)
    .leftJoin(englishTopic, eq(englishReadingPassage.topicId, englishTopic.id))
    .where(eq(englishReadingPassage.isActive, true))
    .groupBy(englishReadingPassage.topicId, englishTopic.name, englishReadingPassage.cefrLevel);

  return rows
    .filter(
      (row): row is typeof row & { topicId: number; topicName: string } =>
        row.topicId !== null && row.topicName !== null
    )
    .map((row) => ({ topicId: row.topicId, topicName: row.topicName, cefrLevel: row.cefrLevel, total: row.total }));
}

export default {
  getCount,
  getCountsByBucket,
  getRecentTitles,
  listPassages,
  listPassageModels,
  getById,
  insertPassages,
  updatePassage,
  deletePassage,
  listQuestionGenCandidates,
  incrementQuestionGenAttempts,
  resetQuestionGenAttempts,
  getTopicCoverage,
  getMaxPerBucket,
  getRefillThreshold,
  getPerBucketGenerationCap,
  getExcludeRecentTitleCount
};
