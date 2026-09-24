import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  englishReadingPassage,
  englishReadingQuestion,
  type InsertEnglishReadingQuestion
} from '@/core/db/schema/main';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { OPTIONS_PER_QUESTION } from './prompt/reading-question';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import type { EngLevel } from './questionTypes';

export interface ReadingQuestionRecord {
  id: number;
  passageRefId: number;
  quizType: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  cefrLevel: string;
  topicId: number | null;
  topicName: string | null;
  type: string;
  forBeginner: boolean;
  model: string;
  tokenIn: number;
  tokenOut: number;
  isActive: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type ReadingQuestionsSort =
  'id_asc' | 'id_desc' | 'created_asc' | 'created_desc' | 'passage_asc' | 'passage_desc';

export const READING_QUESTION_SORTS: ReadingQuestionsSort[] = [
  'id_asc',
  'id_desc',
  'created_asc',
  'created_desc',
  'passage_asc',
  'passage_desc'
];

export interface ListReadingQuestionsInput {
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

export interface ReadingQuestionPage {
  items: ReadingQuestionRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReadingQuestionModelStat {
  model: string;
  count: number;
}

export interface InsertReadingQuestionInput {
  passageRefId: number;
  quizType: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  cefrLevel: EngLevel;
  topicId: number | null;
  topicName: string | null;
  type: string;
  forBeginner?: boolean;
  model: string;
  tokenIn: number;
  tokenOut: number;
}

export const LIST_QUESTIONS_DEFAULT_PAGE_SIZE = 20;
export const LIST_QUESTIONS_MAX_PAGE_SIZE = 100;

export function getQuestionsPerPassage(): number {
  return getEnglishConfigSnapshot().reading_question.questionsPerPassage;
}

export function getPerPassageGenerationCap(): number {
  return getEnglishConfigSnapshot().reading_question.perPassageGenerationCap;
}

export function getMaxGenerationAttempts(): number {
  return getEnglishConfigSnapshot().reading_question.maxGenerationAttempts;
}

// drizzle ilike() không tự escape — giống questionPool/readingPassage service.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SELECT_COLUMNS = {
  id: englishReadingQuestion.id,
  passageRefId: englishReadingQuestion.passageRefId,
  quizType: englishReadingQuestion.quizType,
  question: englishReadingQuestion.question,
  options: englishReadingQuestion.options,
  correctAnswer: englishReadingQuestion.correctAnswer,
  explanation: englishReadingQuestion.explanation,
  cefrLevel: englishReadingQuestion.cefrLevel,
  topicId: englishReadingQuestion.topicId,
  topicName: englishReadingQuestion.topicName,
  type: englishReadingQuestion.type,
  forBeginner: englishReadingQuestion.forBeginner,
  model: englishReadingQuestion.model,
  tokenIn: englishReadingQuestion.tokenIn,
  tokenOut: englishReadingQuestion.tokenOut,
  isActive: englishReadingQuestion.isActive,
  createdAt: englishReadingQuestion.createdAt,
  updatedAt: englishReadingQuestion.updatedAt
};

const ORDER_BY_CLAUSES: Record<ReadingQuestionsSort, SQL[]> = {
  id_asc: [asc(englishReadingQuestion.id)],
  id_desc: [desc(englishReadingQuestion.id)],
  created_asc: [asc(englishReadingQuestion.createdAt), asc(englishReadingQuestion.id)],
  created_desc: [desc(englishReadingQuestion.createdAt), desc(englishReadingQuestion.id)],
  passage_asc: [asc(englishReadingQuestion.passageRefId), asc(englishReadingQuestion.id)],
  passage_desc: [desc(englishReadingQuestion.passageRefId), asc(englishReadingQuestion.id)]
};

/**
 * Count câu active của MỌI passage trong 1 query — scan bucket gọi hàm này một lần thay
 * vì đếm từng passage (kho passage sẽ lớn dần).
 */
async function getCountsByPassage(): Promise<Map<number, number>> {
  const rows = await db
    .select({ passageRefId: englishReadingQuestion.passageRefId, total: count() })
    .from(englishReadingQuestion)
    .where(eq(englishReadingQuestion.isActive, true))
    .groupBy(englishReadingQuestion.passageRefId);

  return new Map(rows.map((row) => [row.passageRefId, row.total]));
}

async function getCountByPassage(passageId: number): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(englishReadingQuestion)
    .where(and(eq(englishReadingQuestion.passageRefId, passageId), eq(englishReadingQuestion.isActive, true)));
  return result?.total ?? 0;
}

/** Câu đã có của passage — feed vào prompt để lần top-up không hỏi trùng. */
async function getExistingQuestionTexts(passageId: number): Promise<string[]> {
  const rows = await db
    .select({ question: englishReadingQuestion.question })
    .from(englishReadingQuestion)
    .where(and(eq(englishReadingQuestion.passageRefId, passageId), eq(englishReadingQuestion.isActive, true)))
    .orderBy(asc(englishReadingQuestion.id));
  return rows.map((row) => row.question);
}

async function getByPassageIds(passageIds: number[]): Promise<Map<number, ReadingQuestionRecord[]>> {
  if (passageIds.length === 0) return new Map();
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(englishReadingQuestion)
    .where(and(inArray(englishReadingQuestion.passageRefId, passageIds), eq(englishReadingQuestion.isActive, true)))
    .orderBy(asc(englishReadingQuestion.passageRefId), asc(englishReadingQuestion.id));

  const grouped = new Map<number, ReadingQuestionRecord[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.passageRefId) ?? [];
    bucket.push(row);
    grouped.set(row.passageRefId, bucket);
  }
  return grouped;
}

/**
 * Insert có cap theo questionsPerPassage (giống readingPassage.insertPassages): cron và
 * manual có thể chạm cùng passage, phần thừa bị bỏ chứ không làm bài phình quá target.
 */
async function insertQuestions(questions: InsertReadingQuestionInput[]): Promise<number> {
  if (questions.length === 0) return 0;

  const inserted = await db.transaction(async (tx) => {
    const passageIds = [...new Set(questions.map((q) => q.passageRefId))];
    const passageCounts = new Map<number, number>();
    let insertedCount = 0;

    for (const passageId of passageIds) {
      const [result] = await tx
        .select({ total: count() })
        .from(englishReadingQuestion)
        .where(and(eq(englishReadingQuestion.passageRefId, passageId), eq(englishReadingQuestion.isActive, true)));
      passageCounts.set(passageId, result?.total ?? 0);
    }

    const questionsPerPassage = getQuestionsPerPassage();
    for (const question of questions) {
      const currentCount = passageCounts.get(question.passageRefId) ?? 0;

      if (currentCount >= questionsPerPassage) {
        logger.info(
          `[ReadingQuestion] Passage full (${currentCount}/${questionsPerPassage}) passageId=${question.passageRefId}, skipping`
        );
        continue;
      }

      const values: InsertEnglishReadingQuestion = {
        passageRefId: question.passageRefId,
        quizType: question.quizType,
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        cefrLevel: question.cefrLevel,
        topicId: question.topicId,
        topicName: question.topicName,
        type: question.type,
        forBeginner: question.forBeginner ?? false,
        model: question.model,
        tokenIn: question.tokenIn,
        tokenOut: question.tokenOut
      };

      await tx.insert(englishReadingQuestion).values(values);
      passageCounts.set(question.passageRefId, currentCount + 1);
      insertedCount++;
    }

    return insertedCount;
  });

  logger.info(`[ReadingQuestion] Inserted ${inserted}/${questions.length} question(s)`);
  return inserted;
}

async function listQuestions(input: ListReadingQuestionsInput): Promise<ReadingQuestionPage> {
  const pageSize = Math.min(
    Math.max(1, input.pageSize ?? LIST_QUESTIONS_DEFAULT_PAGE_SIZE),
    LIST_QUESTIONS_MAX_PAGE_SIZE
  );
  const page = Math.max(1, input.page ?? 1);

  const conditions = [];
  if (input.passageId !== undefined) conditions.push(eq(englishReadingQuestion.passageRefId, input.passageId));
  if (input.cefrLevel) conditions.push(eq(englishReadingQuestion.cefrLevel, input.cefrLevel));
  if (input.type) conditions.push(eq(englishReadingQuestion.type, input.type));
  if (input.quizType) conditions.push(eq(englishReadingQuestion.quizType, input.quizType));
  if (input.model) conditions.push(eq(englishReadingQuestion.model, input.model));
  if (input.isActive !== undefined) conditions.push(eq(englishReadingQuestion.isActive, input.isActive));
  if (input.forBeginner !== undefined) conditions.push(eq(englishReadingQuestion.forBeginner, input.forBeginner));
  if (input.withoutTopic) conditions.push(isNull(englishReadingQuestion.topicId));
  else if (input.topicId !== undefined) conditions.push(eq(englishReadingQuestion.topicId, input.topicId));

  if (input.createdFrom) conditions.push(gte(englishReadingQuestion.createdAt, new Date(input.createdFrom)));
  if (input.createdTo) conditions.push(lte(englishReadingQuestion.createdAt, new Date(input.createdTo)));

  const keyword = input.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    const matches = [
      ilike(englishReadingQuestion.question, pattern),
      ilike(englishReadingQuestion.explanation, pattern),
      ilike(englishReadingQuestion.model, pattern),
      sql`${englishReadingQuestion.options}::text ILIKE ${pattern}`
    ];
    if (/^\d+$/.test(keyword)) matches.push(eq(englishReadingQuestion.id, Number(keyword)));
    conditions.push(or(...matches)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = ORDER_BY_CLAUSES[input.sort ?? 'id_desc'] ?? ORDER_BY_CLAUSES.id_desc;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(SELECT_COLUMNS)
      .from(englishReadingQuestion)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(englishReadingQuestion).where(whereClause)
  ]);

  const total = totalRow?.total ?? 0;
  return {
    items: rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

async function getById(id: number): Promise<ReadingQuestionRecord | null> {
  const [row] = await db
    .select(SELECT_COLUMNS)
    .from(englishReadingQuestion)
    .where(eq(englishReadingQuestion.id, id))
    .limit(1);
  return row ?? null;
}

async function listQuestionModels(): Promise<ReadingQuestionModelStat[]> {
  const rows = await db
    .select({ model: englishReadingQuestion.model, total: count() })
    .from(englishReadingQuestion)
    .groupBy(englishReadingQuestion.model)
    .orderBy(desc(count()), asc(englishReadingQuestion.model));

  return rows.map((row) => ({ model: row.model, count: row.total }));
}

export interface UpdateReadingQuestionInput {
  question?: string;
  options?: string[];
  correctAnswer?: number;
  explanation?: string;
  isActive?: boolean;
}

async function updateQuestion(id: number, patch: UpdateReadingQuestionInput): Promise<ReadingQuestionRecord> {
  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: englishReadingQuestion.id, options: englishReadingQuestion.options })
      .from(englishReadingQuestion)
      .where(eq(englishReadingQuestion.id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Không tìm thấy reading question: ${id}`);

    const options = patch.options?.map((option) => option.trim()).filter(Boolean);
    if (options && options.length !== OPTIONS_PER_QUESTION) {
      throw new BusinessLogicException(`options phải có đúng ${OPTIONS_PER_QUESTION} đáp án`);
    }

    // correctAnswer phải hợp lệ với bộ options SAU khi patch, không phải bộ cũ.
    const nextOptions = options ?? existing.options;
    if (patch.correctAnswer !== undefined && (patch.correctAnswer < 0 || patch.correctAnswer >= nextOptions.length)) {
      throw new BusinessLogicException(`correctAnswer phải nằm trong khoảng 0-${nextOptions.length - 1}`);
    }

    const [row] = await tx
      .update(englishReadingQuestion)
      .set({
        ...(patch.question !== undefined ? { question: patch.question.trim() } : {}),
        ...(options ? { options } : {}),
        ...(patch.correctAnswer !== undefined ? { correctAnswer: patch.correctAnswer } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation.trim() } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        updatedAt: new Date()
      })
      .where(eq(englishReadingQuestion.id, id))
      .returning(SELECT_COLUMNS);
    return row;
  });

  if (!updated) throw new NotFoundException(`Không tìm thấy reading question: ${id}`);
  logger.info(`[ReadingQuestion] Updated question id=${id}`);
  return updated;
}

async function deleteQuestion(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(englishReadingQuestion)
      .where(eq(englishReadingQuestion.id, id))
      .returning({ id: englishReadingQuestion.id });
    if (!deleted) throw new NotFoundException(`Không tìm thấy reading question: ${id}`);
  });
  logger.info(`[ReadingQuestion] Deleted question id=${id}`);
}

/**
 * Số passage đã sẵn sàng phục vụ (đủ questionsPerPassage câu active) theo bucket.
 * Dùng cho GET /english/readings/count.
 */
async function countReadyPassages(input: {
  cefrLevel?: string;
  topicId?: number | null;
  type?: string;
  forBeginner?: boolean;
  allowedTopicIds?: number[] | null;
}): Promise<number> {
  if (input.allowedTopicIds !== undefined && input.allowedTopicIds !== null && input.allowedTopicIds.length === 0) {
    return 0;
  }

  const conditions = [eq(englishReadingPassage.isActive, true)];
  if (input.cefrLevel) conditions.push(eq(englishReadingPassage.cefrLevel, input.cefrLevel));
  if (input.type) conditions.push(eq(englishReadingPassage.type, input.type));
  if (input.forBeginner !== undefined) conditions.push(eq(englishReadingPassage.forBeginner, input.forBeginner));
  if (input.topicId !== undefined && input.topicId !== null) {
    conditions.push(eq(englishReadingPassage.topicId, input.topicId));
  } else if (input.allowedTopicIds) {
    // Bài đọc luôn gắn topic, nên "không truyền topicId" = mọi topic. Với tenant bị giới
    // hạn thì phải bó lại theo allow-list, nếu không sẽ lộ topic chưa được cấp.
    conditions.push(inArray(englishReadingPassage.topicId, input.allowedTopicIds));
  }

  const readyIds = db
    .select({ passageRefId: englishReadingQuestion.passageRefId })
    .from(englishReadingQuestion)
    .where(eq(englishReadingQuestion.isActive, true))
    .groupBy(englishReadingQuestion.passageRefId)
    .having(sql`count(*) >= ${getQuestionsPerPassage()}`);

  const [result] = await db
    .select({ total: count() })
    .from(englishReadingPassage)
    .where(and(...conditions, inArray(englishReadingPassage.id, readyIds)));

  return result?.total ?? 0;
}

export interface PassageWithQuestions {
  passage: {
    id: number;
    title: string;
    paragraphs: string[];
    wordCount: number;
    cefrLevel: string;
    topicId: number | null;
    topicName: string | null;
    type: string;
    forBeginner: boolean;
  };
  questions: ReadingQuestionRecord[];
}

/**
 * Lấy ngẫu nhiên 1 passage đã đủ câu hỏi. KHÔNG destructive (giống questionPool.popQuestion)
 * — kho dùng lại được, `excludeIds` để client tự tránh lặp trong một phiên. `type` là hard
 * filter (không nới ở tầng fallback của controller) — daily/academic không bao giờ lẫn nhau.
 */
async function popPassageWithQuestions(input: {
  cefrLevel?: string;
  topicId?: number | null;
  type?: string;
  forBeginner?: boolean;
  excludeIds?: number[];
  allowedTopicIds?: number[] | null;
}): Promise<PassageWithQuestions | null> {
  if (input.allowedTopicIds !== undefined && input.allowedTopicIds !== null && input.allowedTopicIds.length === 0) {
    return null;
  }

  const conditions = [eq(englishReadingPassage.isActive, true)];
  if (input.cefrLevel) conditions.push(eq(englishReadingPassage.cefrLevel, input.cefrLevel));
  if (input.type) conditions.push(eq(englishReadingPassage.type, input.type));
  if (input.forBeginner !== undefined) conditions.push(eq(englishReadingPassage.forBeginner, input.forBeginner));
  if (input.topicId !== undefined && input.topicId !== null) {
    conditions.push(eq(englishReadingPassage.topicId, input.topicId));
  } else if (input.allowedTopicIds) {
    conditions.push(inArray(englishReadingPassage.topicId, input.allowedTopicIds));
  }
  if (input.excludeIds && input.excludeIds.length > 0) {
    conditions.push(notInArray(englishReadingPassage.id, input.excludeIds));
  }

  const readyIds = db
    .select({ passageRefId: englishReadingQuestion.passageRefId })
    .from(englishReadingQuestion)
    .where(eq(englishReadingQuestion.isActive, true))
    .groupBy(englishReadingQuestion.passageRefId)
    .having(sql`count(*) >= ${getQuestionsPerPassage()}`);

  const [passage] = await db
    .select({
      id: englishReadingPassage.id,
      title: englishReadingPassage.title,
      paragraphs: englishReadingPassage.paragraphs,
      wordCount: englishReadingPassage.wordCount,
      cefrLevel: englishReadingPassage.cefrLevel,
      topicId: englishReadingPassage.topicId,
      topicName: englishReadingPassage.topicName,
      type: englishReadingPassage.type,
      forBeginner: englishReadingPassage.forBeginner
    })
    .from(englishReadingPassage)
    .where(and(...conditions, inArray(englishReadingPassage.id, readyIds)))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (!passage) return null;

  const questions = await db
    .select(SELECT_COLUMNS)
    .from(englishReadingQuestion)
    .where(and(eq(englishReadingQuestion.passageRefId, passage.id), eq(englishReadingQuestion.isActive, true)))
    .orderBy(asc(englishReadingQuestion.id));

  return { passage, questions };
}

export default {
  getCountsByPassage,
  getCountByPassage,
  getExistingQuestionTexts,
  getByPassageIds,
  insertQuestions,
  listQuestions,
  listQuestionModels,
  getById,
  updateQuestion,
  deleteQuestion,
  countReadyPassages,
  popPassageWithQuestions,
  getQuestionsPerPassage,
  getPerPassageGenerationCap,
  getMaxGenerationAttempts
};
