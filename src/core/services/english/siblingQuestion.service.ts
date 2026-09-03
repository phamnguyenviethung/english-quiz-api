import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  generateStructuredOutput,
  resolveStudyModel,
  type ModelContext,
  type StructuredOutputUsage
} from '@/configs/aiClient.config';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { englishQuestionPool } from '@/core/db/schema/main';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { QUESTION_SCHEMA_BY_TYPE } from './prompt/question-schema-map';
import { buildAnswerKey, buildLearnerView } from './prompt/review-type-spec';
import { buildSiblingPrompt, SIBLING_LOCK_FIELDS_BY_TYPE, type SiblingContext } from './prompt/sibling-prompt';
import questionPoolService, { getMaxPoolSize, type PushQuestionInput } from './questionPool.service';
import { safeJsonParse, validateCandidate } from './sibling.validators';
import { isSiblingSupported, type SiblingQuizType } from './questionTypes';
import type { DifficultyContext } from './prompt/vocab-prompt';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Batch schema của LLM cap ở 5 item (khớp *BatchSchema trong study.service). */
export const SIBLING_MAX_PER_CALL = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenerateSiblingsOptions {
  count: number;
  model?: string;
  adminNote?: string;
  /** 'manual' cho admin trigger, 'schedule' cho cron auto. */
  context: ModelContext;
  /** true = insert bất kể pool cap (admin chủ động). false = tôn trọng maxPerBucket (auto). */
  forceInsert: boolean;
}

export interface SiblingGenResult {
  sourceQuestionId: number;
  quizType: SiblingQuizType;
  engLevel: string;
  topicId: number | null;
  requested: number;
  /** Số candidate model trả về. */
  generated: number;
  /** Số row thực sự ghi vào english_question_pool. */
  inserted: number;
  /** Candidate bị loại vì không đạt schema / khóa term / độ dài mảng / trùng câu gốc. */
  failed: number;
  /** Candidate hợp lệ nhưng bị bỏ do bucket đã đầy (chỉ xảy ra khi forceInsert=false). */
  skipped: number;
  tokenIn: number;
  tokenOut: number;
  model: string;
  poolQuestionIds: number[];
  warnings: string[];
}

// ─── Guard ───────────────────────────────────────────────────────────────────

// Chống double-submit cùng một câu gốc (endpoint manual chạy đồng bộ nhưng vẫn có thể
// bị bấm 2 lần / job auto trùng bucket).
const activeSiblingSourceIds = new Set<number>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function insertSiblings(rows: PushQuestionInput[], respectCap: boolean): Promise<number[]> {
  if (rows.length === 0) return [];
  const first = rows[0]!;

  return db.transaction(async (tx) => {
    let bucketCount = 0;
    const maxPool = getMaxPoolSize();
    if (respectCap) {
      const [r] = await tx
        .select({ total: count() })
        .from(englishQuestionPool)
        .where(
          and(
            eq(englishQuestionPool.engLevel, first.engLevel),
            eq(englishQuestionPool.quizType, first.quizType),
            first.topicId == null ? isNull(englishQuestionPool.topicId) : eq(englishQuestionPool.topicId, first.topicId)
          )
        );
      bucketCount = r?.total ?? 0;
    }

    const ids: number[] = [];
    for (const row of rows) {
      if (respectCap && bucketCount >= maxPool) break;
      const [inserted] = await tx
        .insert(englishQuestionPool)
        .values({
          quizType: row.quizType,
          engLevel: row.engLevel,
          optionCount: row.optionCount,
          questionData: row.questionData,
          model: row.model,
          tokenIn: row.tokenIn,
          tokenOut: row.tokenOut,
          topicId: row.topicId ?? null,
          sourceQuestionId: row.sourceQuestionId ?? null
        })
        .returning({ id: englishQuestionPool.id });
      if (inserted) {
        ids.push(inserted.id);
        bucketCount++;
      }
    }
    return ids;
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Sinh tối đa `count` câu tương tự (sibling) từ một câu pool gốc và ghi thẳng vào
 * english_question_pool. Không có bước duyệt — câu đạt validate là câu pool bình thường.
 * Không throw cho lỗi từng candidate; throw cho lỗi đầu vào (không tìm thấy / loại không hỗ trợ).
 */
async function generateSiblingsForSource(sourceId: number, opts: GenerateSiblingsOptions): Promise<SiblingGenResult> {
  const requested = Math.min(Math.max(1, Math.trunc(opts.count)), SIBLING_MAX_PER_CALL);

  const item = await questionPoolService.getPoolQuestionById(sourceId);
  if (!item) throw new NotFoundException(`Không tìm thấy câu pool: ${sourceId}`);
  if (!isSiblingSupported(item.quizType)) {
    throw new BusinessLogicException(`Loại câu "${item.quizType}" không hỗ trợ sinh câu tương tự`);
  }
  const quizType = item.quizType;

  const source = safeJsonParse(item.questionData);
  if (!source || typeof source !== 'object') {
    throw new BusinessLogicException('questionData của câu gốc không phải JSON object hợp lệ');
  }
  const sourceObj = source as Record<string, unknown>;

  if (activeSiblingSourceIds.has(sourceId)) {
    throw new BusinessLogicException('Đang sinh câu tương tự cho câu này, thử lại sau');
  }
  activeSiblingSourceIds.add(sourceId);

  try {
    const resolved = await resolveStudyModel(opts.context, opts.model);
    const ctx: SiblingContext = {
      engLevel: item.engLevel as DifficultyContext['engLevel'],
      optionCount: item.optionCount as DifficultyContext['optionCount'],
      show5050: false,
      model: resolved.model,
      provider: resolved.provider,
      topicName: item.topicName
    };

    const lockedValues: Record<string, unknown> = {};
    for (const key of SIBLING_LOCK_FIELDS_BY_TYPE[quizType]) lockedValues[key] = sourceObj[key];

    const { view, layout } = buildLearnerView(quizType, sourceObj);
    const answerKey = buildAnswerKey(quizType, sourceObj, layout);

    const perTypeSchema = QUESTION_SCHEMA_BY_TYPE[quizType]!;
    const batchSchema = z.object({
      questions: z.array(perTypeSchema).min(1).max(SIBLING_MAX_PER_CALL)
    });

    const { data, usage } = await generateStructuredOutput(batchSchema, {
      model: resolved.model,
      provider: resolved.provider,
      instructions: buildSiblingPrompt(quizType, ctx, {
        lockedValues,
        count: requested,
        adminNote: opts.adminNote
      }),
      input:
        `Đây là CÂU GỐC. Tạo ${requested} câu tương tự theo đúng ràng buộc ở system prompt.\n\n` +
        `${view}\n\n${answerKey}\n\n` +
        `=== RAW JSON câu gốc (chỉ để biết shape/keys phải trả về — KHÔNG chép nội dung) ===\n${JSON.stringify(sourceObj)}`,
      temperature: 0.7,
      maxOutputTokens: 6000
    });

    const candidates: unknown[] = Array.isArray(data.questions) ? data.questions : [];
    const generated = candidates.length;
    const tokenIn = usage?.inputTokens ?? 0;
    const tokenOut = usage?.outputTokens ?? 0;
    const model = usage?.model ?? resolved.model;

    const warnings: string[] = [];
    let failed = 0;
    const valid: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      const check = validateCandidate(quizType, sourceObj, candidate, item.optionCount);
      if (check.ok) {
        valid.push(check.data);
        warnings.push(...check.warnings);
      } else {
        failed++;
        warnings.push(`Loại 1 candidate: ${check.reason}`);
      }
    }

    // Chia đều token cho các candidate hợp lệ (không có breakdown per-item từ LLM).
    const perTokenIn = valid.length > 0 ? Math.round(tokenIn / valid.length) : 0;
    const perTokenOut = valid.length > 0 ? Math.round(tokenOut / valid.length) : 0;
    const pushRows: PushQuestionInput[] = valid.map((q) => ({
      quizType,
      engLevel: item.engLevel,
      optionCount: item.optionCount,
      questionData: JSON.stringify(q),
      model,
      tokenIn: perTokenIn,
      tokenOut: perTokenOut,
      topicId: item.topicId,
      sourceQuestionId: sourceId
    }));

    const poolQuestionIds = await insertSiblings(pushRows, !opts.forceInsert);
    const inserted = poolQuestionIds.length;
    const skipped = Math.max(0, valid.length - inserted);

    logger.info(
      `[Sibling] source=${sourceId} type=${quizType} requested=${requested} generated=${generated} ` +
        `inserted=${inserted} failed=${failed} skipped=${skipped} model=${model} context=${opts.context}`
    );

    return {
      sourceQuestionId: sourceId,
      quizType,
      engLevel: item.engLevel,
      topicId: item.topicId,
      requested,
      generated,
      inserted,
      failed,
      skipped,
      tokenIn,
      tokenOut,
      model,
      poolQuestionIds,
      warnings
    };
  } catch (err) {
    if (err instanceof BusinessLogicException || err instanceof NotFoundException) throw err;
    logger.error(`[Sibling] Generation failed source=${sourceId}: ${errMessage(err)}`);
    throw new BusinessLogicException(`Sinh câu tương tự thất bại: ${errMessage(err).slice(0, 300)}`);
  } finally {
    activeSiblingSourceIds.delete(sourceId);
  }
}

export type { StructuredOutputUsage };

export default {
  generateSiblingsForSource,
  SIBLING_MAX_PER_CALL
};
