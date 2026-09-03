import db from '@/configs/orm.config';
import { englishQuestionPool, englishTopic, type EnglishTopic } from '@/core/db/schema/main';
import { QUESTION_FIXTURE_BY_TYPE, type FixtureQuizType } from '../fixtures/pool-question.fixture';

/**
 * Seed dữ liệu nghiệp vụ bằng INSERT thẳng, cố ý KHÔNG đi qua service.
 *
 * pushQuestions() có trần maxPerBucket bên trong — dùng nó để seed thì không dựng được
 * trạng thái "bucket đã đầy/quá đầy" để test chính cái trần đó. Seed phải là đường độc lập
 * với đường đang được kiểm tra.
 */

export async function createTopic(name: string, description?: string): Promise<EnglishTopic> {
  const [row] = await db
    .insert(englishTopic)
    .values({ name, displayName: name, description: description ?? null })
    .returning();
  if (!row) throw new Error(`[test/seed] Không tạo được topic ${name}`);
  return row;
}

export interface SeedPoolQuestionInput {
  engLevel?: string;
  quizType?: FixtureQuizType;
  topicId?: number | null;
  optionCount?: number;
  model?: string;
  tokenIn?: number;
  tokenOut?: number;
  sourceQuestionId?: number | null;
  /** Ghi đè field trong questionData (vd đổi `word` để phân biệt các câu). */
  dataOverrides?: Record<string, unknown>;
  createdAt?: Date;
}

export async function seedPoolQuestion(input: SeedPoolQuestionInput = {}): Promise<number> {
  const quizType = input.quizType ?? 'vocab';
  const optionCount = input.optionCount ?? 4;
  const data = QUESTION_FIXTURE_BY_TYPE[quizType]({ optionCount, overrides: input.dataOverrides });

  const [row] = await db
    .insert(englishQuestionPool)
    .values({
      quizType,
      engLevel: input.engLevel ?? 'A1',
      optionCount,
      questionData: JSON.stringify(data),
      model: input.model ?? 'test/model',
      tokenIn: input.tokenIn ?? 100,
      tokenOut: input.tokenOut ?? 50,
      topicId: input.topicId ?? null,
      sourceQuestionId: input.sourceQuestionId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    })
    .returning({ id: englishQuestionPool.id });

  if (!row) throw new Error('[test/seed] Không insert được câu hỏi pool');
  return row.id;
}

/** Seed nhiều câu cùng bucket, mỗi câu khác nội dung để phân biệt được khi pop. */
export async function seedPoolQuestions(count: number, input: SeedPoolQuestionInput = {}): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(
      await seedPoolQuestion({
        ...input,
        dataOverrides: { ...input.dataOverrides, explanation: `Giải thích số ${i + 1}` }
      })
    );
  }
  return ids;
}

/**
 * Ghi một bucket cron ĐÃ HOÀN THÀNH — dùng để dựng lịch sử refill cho test thứ tự chống đói
 * (`scanBuckets` đọc MAX(finishedAt) của bucket status='success').
 */
export async function seedCronBucketHistory(input: {
  bucketKey: string;
  finishedAt: Date;
  status?: 'success' | 'failed' | 'skipped';
  engLevel?: string;
  quizType?: string;
  topicId?: number | null;
}): Promise<void> {
  const { englishCronJobBucket, englishCronJobRun } = await import('@/core/db/schema/main');

  const [run] = await db
    .insert(englishCronJobRun)
    .values({
      runId: `test-run-${Math.random().toString(36).slice(2)}`,
      jobKey: 'pool_refill',
      trigger: 'schedule',
      status: 'success'
    })
    .returning({ id: englishCronJobRun.id });
  if (!run) throw new Error('[test/seed] Không tạo được cron run');

  await db.insert(englishCronJobBucket).values({
    runRefId: run.id,
    bucketKey: input.bucketKey,
    status: input.status ?? 'success',
    engLevel: input.engLevel ?? 'A1',
    quizType: input.quizType ?? 'vocab',
    optionCount: 4,
    topicId: input.topicId ?? null,
    topicName: null,
    requestedCount: 1,
    finishedAt: input.finishedAt
  });
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface SeedPassageInput {
  title?: string;
  cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2';
  topicId?: number | null;
  topicName?: string | null;
  type?: 'daily' | 'academic';
  model?: string;
  isActive?: boolean;
  questionGenAttempts?: number;
  paragraphs?: string[];
}

export async function seedPassage(input: SeedPassageInput = {}): Promise<number> {
  const { englishReadingPassage } = await import('@/core/db/schema/main');
  const paragraphs = input.paragraphs ?? [
    'Anna wakes up early every morning and runs in the park near her house.',
    'After running she makes breakfast and reads the news before going to work.'
  ];

  const [row] = await db
    .insert(englishReadingPassage)
    .values({
      title: input.title ?? `Passage ${Math.random().toString(36).slice(2, 8)}`,
      paragraphs,
      wordCount: paragraphs.join(' ').split(/\s+/).filter(Boolean).length,
      cefrLevel: input.cefrLevel ?? 'A1',
      topicId: input.topicId ?? null,
      topicName: input.topicName ?? null,
      type: input.type ?? 'daily',
      model: input.model ?? 'test/model',
      tokenIn: 500,
      tokenOut: 200,
      isActive: input.isActive ?? true,
      questionGenAttempts: input.questionGenAttempts ?? 0
    })
    .returning({ id: englishReadingPassage.id });

  if (!row) throw new Error('[test/seed] Không insert được passage');
  return row.id;
}

export interface SeedReadingQuestionInput {
  passageRefId: number;
  quizType?: string;
  question?: string;
  options?: string[];
  correctAnswer?: number;
  cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2';
  topicId?: number | null;
  type?: 'daily' | 'academic';
  isActive?: boolean;
}

export async function seedReadingQuestion(input: SeedReadingQuestionInput): Promise<number> {
  const { englishReadingQuestion } = await import('@/core/db/schema/main');
  const suffix = Math.random().toString(36).slice(2, 8);

  const [row] = await db
    .insert(englishReadingQuestion)
    .values({
      passageRefId: input.passageRefId,
      quizType: input.quizType ?? 'detail',
      question: input.question ?? `What does Anna do (${suffix})?`,
      options: input.options ?? [
        `She runs ${suffix}`,
        `She swims ${suffix}`,
        `She reads ${suffix}`,
        `She cooks ${suffix}`
      ],
      correctAnswer: input.correctAnswer ?? 0,
      explanation: 'Đoạn [1] nói rõ điều này.',
      cefrLevel: input.cefrLevel ?? 'A1',
      topicId: input.topicId ?? null,
      topicName: null,
      type: input.type ?? 'daily',
      model: 'test/model',
      tokenIn: 100,
      tokenOut: 50,
      isActive: input.isActive ?? true
    })
    .returning({ id: englishReadingQuestion.id });

  if (!row) throw new Error('[test/seed] Không insert được reading question');
  return row.id;
}

/** Passage + đủ bộ câu hỏi active -> sẵn sàng được `/english/readings/pop` phục vụ. */
export async function seedReadyPassage(input: SeedPassageInput & { questionCount?: number } = {}): Promise<number> {
  const passageId = await seedPassage(input);
  const count = input.questionCount ?? 3;
  for (let i = 0; i < count; i += 1) {
    await seedReadingQuestion({
      passageRefId: passageId,
      cefrLevel: input.cefrLevel ?? 'A1',
      topicId: input.topicId ?? null,
      type: input.type ?? 'daily'
    });
  }
  return passageId;
}
