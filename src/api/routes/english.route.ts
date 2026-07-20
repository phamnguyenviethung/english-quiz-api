import { Elysia, t } from 'elysia';
import logger from '@/configs/logger.config';
import { ok, notFound } from '@/api/common/response';
import studyService, { pickStudyModel, type DifficultyContext } from '@/core/services/english/study.service';
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
import { QUIZ_TYPES, isQuizType, type QuizType } from '@/core/services/english/questionTypes';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ENG_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;
type EngLevel = (typeof ENG_LEVELS)[number];

/**
 * Map mỗi quizType tới method sinh câu hỏi (single) tương ứng trong StudyService.
 * `vocab` dùng generateQuestion; các loại còn lại theo tên generateXQuestion.
 */
async function generateSingle(quizType: QuizType, ctx: DifficultyContext, excludeWords?: string[]) {
  switch (quizType) {
    case 'vocab':
      return studyService.generateQuestion(ctx, excludeWords);
    case 'fillblank':
      return studyService.generateFillBlankQuestion(ctx, excludeWords);
    case 'phrase':
      return studyService.generatePhraseQuestion(ctx, excludeWords);
    case 'conversation':
      return studyService.generateConversationQuestion(ctx, excludeWords);
    case 'description':
      return studyService.generateDescriptionQuestion(ctx, excludeWords);
    case 'synonym':
      return studyService.generateSynonymQuestion(ctx, excludeWords);
    case 'slang':
      return studyService.generateSlangQuestion(ctx, excludeWords);
    case 'odd-one-out':
      return studyService.generateOddOneOutQuestion(ctx, excludeWords);
    case 'paragraph':
      return studyService.generateParagraphQuestion(ctx, excludeWords);
    case 'idiom':
      return studyService.generateIdiomQuestion(ctx, excludeWords);
    case 'verb-use-match':
      return studyService.generateVerbUseMatchQuestion(ctx, excludeWords);
    default:
      throw new Error(`Unsupported quizType: ${quizType}`);
  }
}

async function buildDifficultyContext(input: {
  engLevel: EngLevel;
  optionCount: 3 | 4 | 5;
  topicName?: string | null;
  model?: string;
}): Promise<DifficultyContext> {
  return {
    engLevel: input.engLevel,
    optionCount: input.optionCount,
    show5050: true,
    model: input.model ?? (await pickStudyModel(input.engLevel)),
    topicName: input.topicName ?? null
  };
}

// ─── Route ──────────────────────────────────────────────────────────────────

export const englishRoute = new Elysia({ prefix: '/english' })
  // ── Meta ──────────────────────────────────────────────────────────────────
  .get('/quiz-types', () => ok(QUIZ_TYPES))

  // ── Generation on-demand ────────────────────────────────────────────────────
  .post(
    '/generate/:quizType',
    async ({ params, body, status }) => {
      const { quizType } = params;
      if (!isQuizType(quizType)) return status(400, { success: false, message: `Invalid quizType: ${quizType}` });

      const ctx = await buildDifficultyContext({
        engLevel: body.engLevel,
        optionCount: body.optionCount,
        topicName: body.topic ?? null,
        model: body.model
      });

      logger.info(`[API] Generate ${quizType} engLevel=${ctx.engLevel} optionCount=${ctx.optionCount}`);
      const result = await generateSingle(quizType, ctx, body.excludeWords);
      return ok({ quizType, ...result });
    },
    {
      params: t.Object({ quizType: t.String() }),
      body: t.Object({
        engLevel: t.Union(ENG_LEVELS.map((l) => t.Literal(l))),
        optionCount: t.Union([t.Literal(3), t.Literal(4), t.Literal(5)]),
        topic: t.Optional(t.String()),
        model: t.Optional(t.String()),
        excludeWords: t.Optional(t.Array(t.String()))
      })
    }
  )

  // ── Reading (loại đặc biệt, không nằm trong quiz pool distribution) ──────────
  .post(
    '/generate-reading',
    async ({ body }) => {
      const ctx = await buildDifficultyContext({
        engLevel: body.engLevel,
        optionCount: body.optionCount,
        model: body.model
      });
      logger.info(`[API] Generate reading engLevel=${ctx.engLevel} optionCount=${ctx.optionCount}`);
      return ok({ quizType: 'reading', ...(await studyService.generateReadingQuestion(ctx)) });
    },
    {
      body: t.Object({
        engLevel: t.Union(ENG_LEVELS.map((l) => t.Literal(l))),
        optionCount: t.Union([t.Literal(3), t.Literal(4), t.Literal(5)]),
        model: t.Optional(t.String())
      })
    }
  )

  // ── Question pool ───────────────────────────────────────────────────────────
  .get(
    '/pool/pop',
    async ({ query }) => {
      const topicId = query.topicId !== undefined ? Number(query.topicId) : null;
      const question = await questionPoolService.popQuestion(query.engLevel, topicId);
      if (!question) return notFound('Pool trống cho bucket này');
      return ok(question);
    },
    {
      query: t.Object({
        engLevel: t.Union(ENG_LEVELS.map((l) => t.Literal(l))),
        topicId: t.Optional(t.String())
      })
    }
  )
  .get(
    '/pool/count',
    async ({ query }) => {
      const topicId = query.topicId !== undefined ? Number(query.topicId) : null;
      if (!isQuizType(query.quizType)) return { success: false as const, message: 'Invalid quizType' };
      const total = await questionPoolService.getPoolCount(query.engLevel, query.quizType, topicId);
      return ok({ engLevel: query.engLevel, quizType: query.quizType, topicId, count: total });
    },
    {
      query: t.Object({
        engLevel: t.Union(ENG_LEVELS.map((l) => t.Literal(l))),
        quizType: t.String(),
        topicId: t.Optional(t.String())
      })
    }
  )
  .post(
    '/pool/fill',
    async ({ body, status }) => {
      if (!isQuizType(body.quizType)) return status(400, { success: false, message: 'Invalid quizType' });
      const topicId = body.topicId ?? null;
      await questionPoolTriggerService.ensurePoolFilled(
        body.engLevel,
        topicId,
        body.topicName ?? null,
        body.quizType,
        body.optionCount
      );
      return ok({ enqueued: true });
    },
    {
      body: t.Object({
        engLevel: t.Union(ENG_LEVELS.map((l) => t.Literal(l))),
        quizType: t.String(),
        optionCount: t.Union([t.Literal(4), t.Literal(5)]),
        topicId: t.Optional(t.Nullable(t.Number())),
        topicName: t.Optional(t.Nullable(t.String()))
      })
    }
  )
  .get('/pool/pick-quiz-type', () => ok({ quizType: pickQuizType() }))

  // ── Config ──────────────────────────────────────────────────────────────────
  .get('/config', () => ok(getEnglishConfigSnapshot()))
  .get('/config/records', async () => ok(await getAllEnglishConfigRows()))
  .patch(
    '/config/:recordKey',
    async ({ params, body }) => ok(await updateEnglishConfig(params.recordKey, body.value)),
    {
      params: t.Object({ recordKey: t.String() }),
      body: t.Object({ value: t.Unknown() })
    }
  )
  .post('/config/:recordKey/reset', async ({ params }) => ok(await resetEnglishConfigToDefault(params.recordKey)), {
    params: t.Object({ recordKey: t.String() })
  })

  // ── Topics ──────────────────────────────────────────────────────────────────
  .get('/topics', async () => ok(await topicService.getAllActiveTopics()))
  .get('/topics/random-pairs', async ({ query }) => {
    const pairCount = query.pairCount ? Number(query.pairCount) : 1;
    return ok(await topicService.getRandomTopicPairs(pairCount, []));
  })
  .post('/topics', async ({ body }) => ok(await topicService.createTopic(body.name, body.description)), {
    body: t.Object({ name: t.String(), description: t.Optional(t.String()) })
  })

  // ── Cron tracking (admin/observability) ─────────────────────────────────────
  .get('/cron/runs', async ({ query }) => {
    const limit = query.limit ? Number(query.limit) : 8;
    return ok(await englishCronJobTrackingService.getRecentRuns(limit));
  })
  .get('/cron/runs/:runId', async ({ params }) => {
    const detail = await englishCronJobTrackingService.getRunDetail(params.runId);
    if (!detail) return notFound('Không tìm thấy run');
    return ok(detail);
  }, { params: t.Object({ runId: t.String() }) });
