import { beforeEach, describe, expect, it } from 'bun:test';
import { buildManualSiblingPlan, processSiblingBucket } from '@/core/services/english/siblingRefill.service';
import { bucketKeyOf, type RefillBucketCandidate } from '@/core/services/english/poolRefill.service';
import questionPoolService from '@/core/services/english/questionPool.service';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import { SIBLING_SUPPORTED_QUIZ_TYPES } from '@/core/services/english/questionTypes';
import { resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';
import db from '@/configs/orm.config';
import { aiModel } from '@/core/db/schema/main';
import tracking from '@/core/services/english/englishCronJobTracking.service';

let topicId: number;

async function onlyQuizType(quizType: string): Promise<void> {
  const items = getEnglishConfigSnapshot().quiz_distribution.map((item) => ({
    ...item,
    enabled: item.quizType === quizType,
    weight: item.quizType === quizType ? 10 : 0
  }));
  await setConfig({ 'quiz_distribution.items': items });
}

beforeEach(async () => {
  await resetDb();
  mockLLM.reset();
  topicId = (await createTopic('daily-life')).id;
  await onlyQuizType('vocab');
});

function sibling(index: number): Record<string, unknown> {
  return vocabQuestion({
    overrides: {
      wrongAnswers: [`a${index}`, `b${index}`, `c${index}`],
      wrongAnswerExplanations: [`x${index}`, `y${index}`, `z${index}`],
      exampleSentence: `Unique sentence ${index}.`
    }
  });
}

function candidateFor(engLevel: string, currentCount: number, deficiency: number): RefillBucketCandidate {
  return {
    engLevel: engLevel as RefillBucketCandidate['engLevel'],
    quizType: 'vocab',
    optionCount: 4,
    topicId,
    topicName: 'daily-life',
    forBeginner: false,
    currentCount,
    deficiency
  };
}

describe('buildManualSiblingPlan — công thức số lượng', () => {
  it('chỉ xét các quizType hỗ trợ sinh sibling', async () => {
    await onlyQuizType('odd-one-out'); // không nằm trong danh sách hỗ trợ
    const plan = await buildManualSiblingPlan({ scope: 'all' });
    expect(plan.matched).toHaveLength(0);
  });

  it('bucket không có câu gốc nào -> plannedCount 0, không vào planned', async () => {
    const plan = await buildManualSiblingPlan({ scope: 'all', sourcesPerBucket: 2, siblingsPerSource: 3 });

    expect(plan.matched).toHaveLength(4); // 4 engLevel
    expect(plan.matched.every((item) => item.sourceCount === 0)).toBe(true);
    expect(plan.planned).toHaveLength(0);
    expect(plan.totalPlannedSiblings).toBe(0);
  });

  it("scope 'all': maxSiblings = min(sourcesPerBucket, sourceCount) × siblingsPerSource", async () => {
    await seedPoolQuestions(5, { engLevel: 'A1', quizType: 'vocab', topicId });

    const plan = await buildManualSiblingPlan({ scope: 'all', sourcesPerBucket: 2, siblingsPerSource: 3 });
    const a1 = plan.planned.find((item) => item.engLevel === 'A1')!;

    expect(a1.sourceCount).toBe(5);
    expect(a1.plannedCount).toBe(6); // min(2, 5) * 3
    expect(a1.plannedSources).toBe(2); // ceil(6 / 3)
  });

  it('sourceCount nhỏ hơn sourcesPerBucket thì lấy theo sourceCount', async () => {
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });

    const plan = await buildManualSiblingPlan({ scope: 'all', sourcesPerBucket: 5, siblingsPerSource: 3 });
    const a1 = plan.planned.find((item) => item.engLevel === 'A1')!;

    expect(a1.plannedCount).toBe(3); // min(5, 1) * 3
  });

  it("scope 'deficient' cắt thêm theo phần bucket còn thiếu", async () => {
    // 2 câu gốc -> maxSiblings = min(2,2)*3 = 6, nhưng bucket chỉ còn thiếu 1 (max 3).
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });

    const plan = await buildManualSiblingPlan({ scope: 'deficient', sourcesPerBucket: 2, siblingsPerSource: 3 });
    const a1 = plan.planned.find((item) => item.engLevel === 'A1')!;

    expect(a1.plannedCount).toBe(1);
    expect(a1.plannedSources).toBe(1); // ceil(1/3)
  });

  it("scope 'deficient': bucket đã đầy -> plannedCount 0", async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });

    const plan = await buildManualSiblingPlan({ scope: 'deficient', sourcesPerBucket: 2, siblingsPerSource: 3 });

    expect(plan.planned.some((item) => item.engLevel === 'A1')).toBe(false);
    expect(plan.matched.some((item) => item.engLevel === 'A1')).toBe(true); // vẫn hiện trong preview
  });

  it('chỉ đếm câu GỐC làm nguồn (sibling không sinh ra sibling)', async () => {
    const source = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId, sourceQuestionId: source });

    const plan = await buildManualSiblingPlan({ scope: 'all', sourcesPerBucket: 5, siblingsPerSource: 2 });
    const a1 = plan.matched.find((item) => item.engLevel === 'A1')!;

    expect(a1.currentCount).toBe(2);
    expect(a1.sourceCount).toBe(1);
    expect(a1.plannedCount).toBe(2); // min(5,1) * 2
  });

  it('quizTypes hỗ trợ một phần: chỉ giữ phần được hỗ trợ', async () => {
    await onlyQuizType('vocab');
    const plan = await buildManualSiblingPlan({
      scope: 'all',
      filter: { quizTypes: ['vocab', 'odd-one-out'] as never }
    });

    expect(plan.matched).toHaveLength(4);
    expect(plan.matched.every((item) => item.quizType === 'vocab')).toBe(true);
  });

  /**
   * Lọc toàn quizType không hỗ trợ phải cho plan rỗng, không được hiểu mảng rỗng thành "không
   * lọc" (scanBuckets coi mảng rỗng là quét hết). Controller đã chặn trường hợp này bằng 400,
   * đây là lớp phòng thủ thứ hai. Xem test/notes/FINDINGS.md #2 (đã sửa).
   */
  it('lọc toàn quizType không hỗ trợ -> plan rỗng, không quét toàn bộ', async () => {
    await onlyQuizType('vocab');
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    const plan = await buildManualSiblingPlan({
      scope: 'all',
      filter: { quizTypes: ['odd-one-out', 'paragraph'] as never }
    });

    expect(plan.matched).toHaveLength(0);
    expect(plan.planned).toHaveLength(0);
    expect(plan.totalPlannedSiblings).toBe(0);
  });

  it('totalPlannedSiblings = tổng plannedCount', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestions(2, { engLevel: 'A2', quizType: 'vocab', topicId });

    const plan = await buildManualSiblingPlan({ scope: 'all', sourcesPerBucket: 1, siblingsPerSource: 2 });

    expect(plan.totalPlannedSiblings).toBe(plan.planned.reduce((s, i) => s + i.plannedCount, 0));
    expect(plan.totalPlannedSiblings).toBe(4);
  });

  it('9 loại được hỗ trợ, không có odd-one-out và paragraph', () => {
    expect(SIBLING_SUPPORTED_QUIZ_TYPES).toHaveLength(9);
    expect(SIBLING_SUPPORTED_QUIZ_TYPES).not.toContain('odd-one-out');
    expect(SIBLING_SUPPORTED_QUIZ_TYPES).not.toContain('paragraph');
  });
});

describe('processSiblingBucket — ngân sách hiệu dụng', () => {
  it('budget <= 0 -> thoát sớm, KHÔNG gọi LLM', async () => {
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });

    const result = await processSiblingBucket(null, candidateFor('A1', 1, 2), {
      sourceLimit: 2,
      siblingsPerSource: 3,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 0
    });

    expect(result).toEqual({ inserted: 0, generated: 0 });
    expect(mockLLM.callCount).toBe(0);
  });

  it('forceInsert = false: budget bị cắt theo deficiency, không đốt token cho phần chắc chắn bị bỏ', async () => {
    // Bucket còn thiếu 1, dù caller cho budget 10 thì cũng chỉ đặt sinh 1.
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [sibling(1)] });

    const result = await processSiblingBucket(null, candidateFor('A1', 2, 1), {
      sourceLimit: 5,
      siblingsPerSource: 3,
      forceInsert: false,
      context: 'manual',
      budgetLeft: 10
    });

    expect(result.inserted).toBe(1);
    expect(mockLLM.callCount).toBe(1);
    // effectiveBudget = 1 -> sourceLimit = ceil(1/3) = 1 -> đúng 1 lời gọi.
  });

  it('forceInsert = true bỏ qua deficiency, dùng đúng budget caller đưa', async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId }); // đã đầy
    mockLLM.enqueue({ questions: [sibling(1), sibling(2)] });

    const result = await processSiblingBucket(null, candidateFor('A1', 3, 0), {
      sourceLimit: 1,
      siblingsPerSource: 2,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 2
    });

    expect(result.inserted).toBe(2);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(5);
  });

  it('trừ ngân sách theo số ĐÃ GHI (inserted), không theo số model sinh ra', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    // Nguồn 1 sinh 2 candidate nhưng 1 cái trùng ngữ cảnh -> chỉ ghi 1.
    mockLLM.enqueue({ questions: [vocabQuestion(), sibling(1)] });
    mockLLM.enqueue({ questions: [sibling(2)] });

    const result = await processSiblingBucket(null, candidateFor('A1', 2, 5), {
      sourceLimit: 2,
      siblingsPerSource: 1,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 2
    });

    expect(result.generated).toBe(3);
    expect(result.inserted).toBe(2);
    expect(mockLLM.callCount).toBe(2); // vẫn cần lượt thứ 2 vì lượt 1 chỉ ghi được 1
  });

  it('không có câu gốc -> không gọi LLM', async () => {
    const result = await processSiblingBucket(null, candidateFor('A1', 0, 3), {
      sourceLimit: 2,
      siblingsPerSource: 3,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 3
    });

    expect(result).toEqual({ inserted: 0, generated: 0 });
    expect(mockLLM.callCount).toBe(0);
  });

  it('một nguồn lỗi không làm hỏng cả bucket', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.fail(new Error('model sập'));
    mockLLM.enqueue({ questions: [sibling(1)] });

    const result = await processSiblingBucket(null, candidateFor('A1', 2, 5), {
      sourceLimit: 2,
      siblingsPerSource: 1,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 2
    });

    expect(result.inserted).toBe(1);
  });

  it('không lấy nguồn nhiều hơn mức cần để phủ ngân sách', async () => {
    await seedPoolQuestions(10, { engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [sibling(1), sibling(2), sibling(3)] });

    await processSiblingBucket(null, candidateFor('A1', 10, 3), {
      sourceLimit: 10,
      siblingsPerSource: 3,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 3
    });

    // budget 3 / 3 sibling mỗi nguồn = 1 nguồn -> đúng 1 lời gọi, không bốc thừa nguồn.
    expect(mockLLM.callCount).toBe(1);
  });
});

describe('preview khớp bucketKey của scan', () => {
  it('SiblingPlanItem giữ nguyên bucketKey chuẩn', async () => {
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    const plan = await buildManualSiblingPlan({ scope: 'all' });
    const a1 = plan.matched.find((item) => item.engLevel === 'A1')!;

    expect(bucketKeyOf(a1)).toBe(`A1:${topicId}:vocab`);
  });
});

/**
 * Client thật (aiClient.config.ts) trả `usage.model` đã cắt prefix provider và không có suffix
 * routing (vd 'gemini-2.5-flash-lite' cho 'google/gemini-2.5-flash-lite:nitro'). Cost phải tính
 * theo model ĐÃ CẤU HÌNH — nếu tra theo usage.model thì không bao giờ khớp ai_models và cost
 * luôn null.
 */
describe('processSiblingBucket — chi phí theo model đã cấu hình', () => {
  const CHEAP = { modelId: 'google/test-cheap:nitro', prompt: 0.000001, completion: 0.000002 };
  const PRICEY = { modelId: 'openai/test-pricey:floor', prompt: 0.00001, completion: 0.00003 };

  async function registerModel(model: typeof CHEAP): Promise<void> {
    await db.insert(aiModel).values({
      key: model.modelId,
      modelId: model.modelId,
      isActive: true,
      manualEnabled: true,
      scheduleEnabled: false,
      readingEnabled: false,
      pricePromptPerToken: model.prompt,
      priceCompletionPerToken: model.completion
    });
  }

  async function startRun() {
    const run = await tracking.startRun({
      jobKey: 'sibling_gen_manual',
      trigger: 'manual',
      totalBuckets: 1,
      deficientBuckets: 1
    });
    if (!run) throw new Error('không tạo được run');
    return run;
  }

  it('cost khác null và đúng giá model đã cấu hình, dù model trả về tên đã cắt prefix', async () => {
    await registerModel(CHEAP);
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [sibling(1)] }, { inputTokens: 1000, outputTokens: 500, model: 'test-cheap' });
    const run = await startRun();

    await processSiblingBucket(run, candidateFor('A1', 1, 5), {
      sourceLimit: 1,
      siblingsPerSource: 1,
      model: CHEAP.modelId,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 1
    });

    const detail = await tracking.getRunDetail(run.runId);
    const expected = CHEAP.prompt * 1000 + CHEAP.completion * 500;
    expect(detail!.attempts[0]!.model).toBe(CHEAP.modelId);
    expect(detail!.attempts[0]!.costUsd).toBeCloseTo(expected, 12);
    expect(detail!.buckets[0]!.costUsd).toBeCloseTo(expected, 12);
  });

  it('nhiều nguồn dùng model khác giá -> cost = tổng giá từng lời gọi theo đúng model của nó', async () => {
    await registerModel(CHEAP);
    await registerModel(PRICEY);
    await seedPoolQuestions(4, { engLevel: 'A1', quizType: 'vocab', topicId });
    for (let i = 0; i < 4; i += 1) {
      mockLLM.enqueue(
        { questions: [sibling(i + 10)] },
        { inputTokens: 1000, outputTokens: 500, model: 'stripped-name' }
      );
    }
    const run = await startRun();

    await processSiblingBucket(run, candidateFor('A1', 4, 10), {
      sourceLimit: 4,
      siblingsPerSource: 1,
      forceInsert: true,
      context: 'manual',
      budgetLeft: 4
    });

    const priceOf = (modelId: string) => [CHEAP, PRICEY].find((m) => m.modelId === modelId)!;
    const expected = mockLLM.calls.reduce((sum, call) => {
      const price = priceOf(call.model);
      return sum + price.prompt * 1000 + price.completion * 500;
    }, 0);
    const detail = await tracking.getRunDetail(run.runId);
    expect(mockLLM.callCount).toBe(4);
    expect(detail!.buckets[0]!.costUsd).toBeCloseTo(expected, 12);
  });

  it('model không có giá -> cost vẫn null (không đổi thành 0)', async () => {
    await db.insert(aiModel).values({ key: 'nopriced', modelId: 'acme/no-price', isActive: true, manualEnabled: true });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [sibling(1)] }, { model: 'no-price' });
    const run = await startRun();

    await processSiblingBucket(run, candidateFor('A1', 1, 5), {
      sourceLimit: 1,
      siblingsPerSource: 1,
      model: 'acme/no-price',
      forceInsert: true,
      context: 'manual',
      budgetLeft: 1
    });

    const detail = await tracking.getRunDetail(run.runId);
    expect(detail!.buckets[0]!.costUsd).toBeNull();
  });
});
