import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import _ from 'lodash';
import { z } from 'zod';
import { generateStructuredOutput, resolveStudyModel } from '@/configs/aiClient.config';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  englishQuestionPool,
  englishQuestionPoolReview,
  englishTopic,
  POOL_REVIEW_VERDICTS,
  type EnglishQuestionPoolReview,
  type InsertEnglishQuestionPoolReview,
  type PoolReviewChecklist
} from '@/core/db/schema/main';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { runWithConcurrency } from '@/utils/concurrency';
import { buildReviewPrompt, type ReviewContext } from './prompt/review-prompt';
import { renderLearnerView } from './prompt/review-type-spec';
import type { DifficultyContext } from './prompt/vocab-prompt';
import questionPoolService from './questionPool.service';
import type { QuizType } from './questionTypes';
import {
  ConversationQuestionSchema,
  DescriptionQuestionSchema,
  FillBlankQuestionSchema,
  IdiomQuestionSchema,
  OddOneOutQuestionSchema,
  ParagraphQuestionSchema,
  PhraseQuestionSchema,
  SlangQuestionSchema,
  SynonymQuestionSchema,
  VerbUseMatchQuestionSchema,
  VocabQuestionSchema
} from './study.service';

// ─── Constants ───────────────────────────────────────────────────────────────

export const POOL_REVIEW_BATCH_MAX = 30;
const POOL_REVIEW_CONCURRENCY = 3;
// Review là thao tác do admin trigger → dùng chung pool model context 'manual'.
const REVIEW_MODEL_CONTEXT = 'manual' as const;

export const LIST_REVIEWS_DEFAULT_PAGE_SIZE = 20;
export const LIST_REVIEWS_MAX_PAGE_SIZE = 100;

export type PoolReviewSort = 'id_desc' | 'id_asc' | 'created_desc' | 'created_asc';
export const POOL_REVIEW_SORTS: PoolReviewSort[] = ['id_desc', 'id_asc', 'created_desc', 'created_asc'];

// quizType → Zod schema của payload câu hỏi (dùng study.service để tránh lệch định nghĩa).
// 'reading' và reading-* không nằm trong english_question_pool nên không có mặt ở đây.
const QUESTION_SCHEMA_BY_TYPE: Partial<Record<QuizType, z.ZodTypeAny>> = {
  vocab: VocabQuestionSchema,
  fillblank: FillBlankQuestionSchema,
  phrase: PhraseQuestionSchema,
  conversation: ConversationQuestionSchema,
  description: DescriptionQuestionSchema,
  synonym: SynonymQuestionSchema,
  slang: SlangQuestionSchema,
  'odd-one-out': OddOneOutQuestionSchema,
  paragraph: ParagraphQuestionSchema,
  idiom: IdiomQuestionSchema,
  'verb-use-match': VerbUseMatchQuestionSchema
};

// ─── Structured output schema ────────────────────────────────────────────────

// 10 cờ AI trả (true = có vấn đề trong bản gốc). `formatValid` do service tự set sau.
const ReviewChecklistAiSchema = z.object({
  notSolvable: z.boolean(),
  insufficientContext: z.boolean(),
  multipleDefensibleAnswers: z.boolean(),
  answerIncorrect: z.boolean(),
  explanationMismatch: z.boolean(),
  distractorExplanationMismatch: z.boolean(),
  translationMismatch: z.boolean(),
  spellingOrGrammarError: z.boolean(),
  offTopic: z.boolean(),
  levelMismatch: z.boolean()
});

const ReviewIssueSchema = z.object({
  field: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  problem: z.string(),
  fix: z.string()
});

const PoolReviewResultSchema = z.object({
  verdict: z.enum(POOL_REVIEW_VERDICTS),
  summary: z.string(),
  score: z.number().min(0).max(100),
  checklist: ReviewChecklistAiSchema,
  issues: z.array(ReviewIssueSchema),
  // Shape phụ thuộc quizType — validate chặt lại bằng QUESTION_SCHEMA_BY_TYPE sau khi có kết quả.
  revisedData: z.record(z.string(), z.unknown())
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** drizzle ilike() không tự escape — % và _ do người dùng gõ phải escape thủ công. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Diff top-level key giữa hai object bằng deep-equal. Type-agnostic, dùng cho mọi quizType. */
function diffTopLevel(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!_.isEqual(a?.[key], b?.[key])) changed.push(key);
  }
  return changed;
}

// ─── Review execution ────────────────────────────────────────────────────────

// Guard chống chạy song song cùng một pool id (kèm check review 'pending' trong DB).
const activeReviewIds = new Set<number>();

async function insertReviewRow(values: InsertEnglishQuestionPoolReview): Promise<EnglishQuestionPoolReview> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(englishQuestionPoolReview).values(values).returning();
    return row!;
  });
}

/**
 * Review một câu trong pool bằng LLM rồi ghi một row english_question_pool_reviews.
 * Không throw ra ngoài — lỗi được ghi thành row status='failed' để batch chạy tiếp.
 */
async function reviewOne(
  poolQuestionId: number,
  opts: { model?: string; adminNote?: string; requestedBy: string }
): Promise<void> {
  const item = await questionPoolService.getPoolQuestionById(poolQuestionId);
  if (!item) {
    logger.warn(`[PoolReview] Pool question not found id=${poolQuestionId}, skip`);
    return;
  }

  const quizType = item.quizType;
  const adminNote = opts.adminNote?.trim() || null;
  const snapshot = {
    poolQuestionRefId: item.id,
    quizType,
    engLevel: item.engLevel,
    optionCount: item.optionCount,
    topicId: item.topicId,
    topicName: item.topicName,
    adminNote,
    originalData: item.questionData
  };

  const original = safeJsonParse(item.questionData);
  if (!original || typeof original !== 'object') {
    await insertReviewRow({
      ...snapshot,
      revisedData: '',
      status: 'failed',
      errorMessage: 'questionData không phải JSON object hợp lệ',
      reviewModel: opts.model ?? ''
    });
    return;
  }

  try {
    const resolved = await resolveStudyModel(REVIEW_MODEL_CONTEXT, opts.model);
    const ctx: ReviewContext = {
      engLevel: item.engLevel as DifficultyContext['engLevel'],
      optionCount: item.optionCount as DifficultyContext['optionCount'],
      show5050: false,
      model: resolved.model,
      provider: resolved.provider,
      topicName: item.topicName
    };

    const learnerView = renderLearnerView(quizType, original as Record<string, unknown>);
    const { data, usage } = await generateStructuredOutput(PoolReviewResultSchema, {
      model: resolved.model,
      provider: resolved.provider,
      instructions: buildReviewPrompt(quizType, ctx, { adminNote: adminNote ?? undefined }),
      input: `${learnerView}\n\n=== RAW JSON (trả revisedData đúng shape này) ===\n${JSON.stringify(original)}`,
      temperature: 0.3,
      maxOutputTokens: 4000
    });

    const perTypeSchema = QUESTION_SCHEMA_BY_TYPE[quizType];
    const parsedRevised = perTypeSchema?.safeParse(data.revisedData);
    const formatValid = parsedRevised?.success ?? false;
    const revisedForStorage = (parsedRevised?.success ? parsedRevised.data : data.revisedData) as Record<
      string,
      unknown
    >;

    const checklist: PoolReviewChecklist = { ...data.checklist, formatValid };

    await insertReviewRow({
      ...snapshot,
      revisedData: JSON.stringify(revisedForStorage),
      verdict: data.verdict,
      summary: data.summary,
      score: Math.round(data.score),
      checklist,
      issues: data.issues,
      changedFields: diffTopLevel(original as Record<string, unknown>, revisedForStorage),
      status: 'pending',
      reviewModel: usage?.model ?? resolved.model,
      tokenIn: usage?.inputTokens ?? 0,
      tokenOut: usage?.outputTokens ?? 0
    });
    logger.info(
      `[PoolReview] Reviewed pool id=${poolQuestionId} verdict=${data.verdict} formatValid=${formatValid} model=${resolved.model}`
    );
  } catch (err) {
    logger.error(`[PoolReview] Review failed pool id=${poolQuestionId}: ${errMessage(err)}`);
    await insertReviewRow({
      ...snapshot,
      revisedData: '',
      status: 'failed',
      errorMessage: errMessage(err).slice(0, 1000),
      reviewModel: opts.model ?? ''
    });
  }
}

/**
 * Nhận danh sách pool id, chạy review fire-and-forget (bounded concurrency) và trả
 * về ngay. Bỏ qua id đang có review 'pending' hoặc đang chạy.
 */
async function enqueueReviews(
  poolQuestionIds: number[],
  opts: { model?: string; adminNote?: string; requestedBy: string }
): Promise<{ accepted: number; skipped: number }> {
  const unique = [...new Set(poolQuestionIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) throw new BusinessLogicException('poolQuestionIds rỗng hoặc không hợp lệ');
  if (unique.length > POOL_REVIEW_BATCH_MAX) {
    throw new BusinessLogicException(`Tối đa ${POOL_REVIEW_BATCH_MAX} câu mỗi lần review`);
  }

  const pendingRows = await db
    .select({ poolQuestionRefId: englishQuestionPoolReview.poolQuestionRefId })
    .from(englishQuestionPoolReview)
    .where(
      and(eq(englishQuestionPoolReview.status, 'pending'), inArray(englishQuestionPoolReview.poolQuestionRefId, unique))
    );
  const pendingSet = new Set(pendingRows.map((row) => row.poolQuestionRefId));

  const toRun = unique.filter((id) => !pendingSet.has(id) && !activeReviewIds.has(id));
  const skipped = unique.length - toRun.length;
  if (toRun.length === 0) return { accepted: 0, skipped };

  for (const id of toRun) activeReviewIds.add(id);

  const tasks = toRun.map((id) => async () => {
    try {
      await reviewOne(id, opts);
    } finally {
      activeReviewIds.delete(id);
    }
  });

  logger.info(`[PoolReview] Batch start: ${toRun.length} câu (skipped=${skipped}) requestedBy=${opts.requestedBy}`);
  void runWithConcurrency(tasks, POOL_REVIEW_CONCURRENCY).then(() => {
    logger.info(`[PoolReview] Batch done: ${toRun.length} câu requestedBy=${opts.requestedBy}`);
  });

  return { accepted: toRun.length, skipped };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export interface ListPoolReviewsInput {
  status?: string;
  verdict?: string;
  quizType?: string;
  engLevel?: string;
  topicId?: number;
  poolQuestionRefId?: number;
  q?: string;
  sort?: PoolReviewSort;
  page?: number;
  pageSize?: number;
}

const REVIEW_LIST_COLUMNS = {
  id: englishQuestionPoolReview.id,
  poolQuestionRefId: englishQuestionPoolReview.poolQuestionRefId,
  quizType: englishQuestionPoolReview.quizType,
  engLevel: englishQuestionPoolReview.engLevel,
  optionCount: englishQuestionPoolReview.optionCount,
  topicId: englishQuestionPoolReview.topicId,
  topicName: englishQuestionPoolReview.topicName,
  adminNote: englishQuestionPoolReview.adminNote,
  verdict: englishQuestionPoolReview.verdict,
  summary: englishQuestionPoolReview.summary,
  score: englishQuestionPoolReview.score,
  checklist: englishQuestionPoolReview.checklist,
  issues: englishQuestionPoolReview.issues,
  changedFields: englishQuestionPoolReview.changedFields,
  status: englishQuestionPoolReview.status,
  errorMessage: englishQuestionPoolReview.errorMessage,
  reviewModel: englishQuestionPoolReview.reviewModel,
  tokenIn: englishQuestionPoolReview.tokenIn,
  tokenOut: englishQuestionPoolReview.tokenOut,
  resolvedByUserId: englishQuestionPoolReview.resolvedByUserId,
  resolvedAt: englishQuestionPoolReview.resolvedAt,
  createdAt: englishQuestionPoolReview.createdAt,
  updatedAt: englishQuestionPoolReview.updatedAt
} as const;

const REVIEW_ORDER_BY: Record<PoolReviewSort, SQL[]> = {
  id_desc: [desc(englishQuestionPoolReview.id)],
  id_asc: [asc(englishQuestionPoolReview.id)],
  created_desc: [desc(englishQuestionPoolReview.createdAt), desc(englishQuestionPoolReview.id)],
  created_asc: [asc(englishQuestionPoolReview.createdAt), asc(englishQuestionPoolReview.id)]
};

async function listReviews(input: ListPoolReviewsInput) {
  const pageSize = Math.min(Math.max(1, input.pageSize ?? LIST_REVIEWS_DEFAULT_PAGE_SIZE), LIST_REVIEWS_MAX_PAGE_SIZE);
  const page = Math.max(1, input.page ?? 1);

  const conditions: SQL[] = [];
  if (input.status) conditions.push(eq(englishQuestionPoolReview.status, input.status));
  if (input.verdict) conditions.push(eq(englishQuestionPoolReview.verdict, input.verdict));
  if (input.quizType) conditions.push(eq(englishQuestionPoolReview.quizType, input.quizType));
  if (input.engLevel) conditions.push(eq(englishQuestionPoolReview.engLevel, input.engLevel));
  if (input.topicId !== undefined) conditions.push(eq(englishQuestionPoolReview.topicId, input.topicId));
  if (input.poolQuestionRefId !== undefined) {
    conditions.push(eq(englishQuestionPoolReview.poolQuestionRefId, input.poolQuestionRefId));
  }

  const keyword = input.q?.trim();
  if (keyword) {
    const pattern = `%${escapeLikePattern(keyword)}%`;
    const matches: SQL[] = [
      ilike(englishQuestionPoolReview.summary, pattern),
      ilike(englishQuestionPoolReview.originalData, pattern),
      ilike(englishQuestionPoolReview.revisedData, pattern)
    ];
    if (/^\d+$/.test(keyword)) {
      matches.push(eq(englishQuestionPoolReview.id, Number(keyword)));
      matches.push(eq(englishQuestionPoolReview.poolQuestionRefId, Number(keyword)));
    }
    conditions.push(or(...matches)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const orderBy = REVIEW_ORDER_BY[input.sort ?? 'id_desc'] ?? REVIEW_ORDER_BY.id_desc;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select(REVIEW_LIST_COLUMNS)
      .from(englishQuestionPoolReview)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(englishQuestionPoolReview).where(whereClause)
  ]);

  const total = totalRow?.total ?? 0;
  return { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function getReviewById(id: number) {
  const [row] = await db.select().from(englishQuestionPoolReview).where(eq(englishQuestionPoolReview.id, id)).limit(1);
  if (!row) return null;

  const original = safeJsonParse(row.originalData);
  const revised = row.revisedData ? safeJsonParse(row.revisedData) : null;
  const changedFields = row.changedFields ?? [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
  const diff = changedFields.map((field) => ({
    field,
    before: isObj(original) ? original[field] : undefined,
    after: isObj(revised) ? revised[field] : undefined
  }));

  return { ...row, original, revised, diff };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

async function approveReview(id: number, opts: { data?: unknown; userId: string }) {
  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(englishQuestionPoolReview)
      .where(eq(englishQuestionPoolReview.id, id))
      .limit(1);
    if (!review) throw new NotFoundException(`Không tìm thấy review: ${id}`);
    if (review.status !== 'pending') {
      throw new BusinessLogicException(`Review đang ở trạng thái "${review.status}", không thể approve`);
    }

    let target: unknown;
    if (opts.data !== undefined) {
      target = opts.data;
    } else {
      if (!review.revisedData) throw new BusinessLogicException('Review không có revisedData để áp dụng');
      target = safeJsonParse(review.revisedData);
      if (target === null) throw new BusinessLogicException('revisedData của review không phải JSON hợp lệ');
    }

    const schema = QUESTION_SCHEMA_BY_TYPE[review.quizType as QuizType];
    if (!schema) throw new BusinessLogicException(`quizType không hỗ trợ review: ${review.quizType}`);
    const parsed = schema.safeParse(target);
    if (!parsed.success) {
      throw new BusinessLogicException(
        `Dữ liệu không đúng schema câu hỏi "${review.quizType}": ${parsed.error.message}`
      );
    }

    const now = new Date();
    const updatedPool = await tx
      .update(englishQuestionPool)
      .set({ questionData: JSON.stringify(parsed.data), updatedAt: now })
      .where(eq(englishQuestionPool.id, review.poolQuestionRefId))
      .returning();
    if (updatedPool.length === 0) {
      throw new NotFoundException(`Pool question ${review.poolQuestionRefId} không còn tồn tại`);
    }

    const [updatedReview] = await tx
      .update(englishQuestionPoolReview)
      .set({ status: 'approved', resolvedByUserId: opts.userId, resolvedAt: now, updatedAt: now })
      .where(eq(englishQuestionPoolReview.id, id))
      .returning();

    logger.info(`[PoolReview] Approved review id=${id} → pool id=${review.poolQuestionRefId} by=${opts.userId}`);
    return { review: updatedReview!, poolQuestion: updatedPool[0]! };
  });
}

async function rejectReview(id: number, opts: { userId: string; note?: string }) {
  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(englishQuestionPoolReview)
      .where(eq(englishQuestionPoolReview.id, id))
      .limit(1);
    if (!review) throw new NotFoundException(`Không tìm thấy review: ${id}`);
    if (review.status !== 'pending') {
      throw new BusinessLogicException(`Review đang ở trạng thái "${review.status}", không thể reject`);
    }

    const now = new Date();
    const note = opts.note?.trim();
    const [updated] = await tx
      .update(englishQuestionPoolReview)
      .set({
        status: 'rejected',
        resolvedByUserId: opts.userId,
        resolvedAt: now,
        updatedAt: now,
        summary: note ? `${review.summary ?? ''}\n[Admin reject] ${note}`.trim() : review.summary
      })
      .where(eq(englishQuestionPoolReview.id, id))
      .returning();

    logger.info(`[PoolReview] Rejected review id=${id} by=${opts.userId}`);
    return updated!;
  });
}

async function deleteReview(id: number): Promise<void> {
  const deleted = await db
    .delete(englishQuestionPoolReview)
    .where(eq(englishQuestionPoolReview.id, id))
    .returning({ id: englishQuestionPoolReview.id });
  if (deleted.length === 0) throw new NotFoundException(`Không tìm thấy review: ${id}`);
  logger.info(`[PoolReview] Deleted review id=${id}`);
}

export default {
  enqueueReviews,
  listReviews,
  getReviewById,
  approveReview,
  rejectReview,
  deleteReview
};
