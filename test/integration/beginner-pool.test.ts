import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import { englishQuestionPool } from '@/core/db/schema/main';
import { BusinessLogicException } from '@/core/exceptions';
import { fillBucketDetailed } from '@/core/cron/question-gen.job';
import { scanBuckets } from '@/core/services/english/poolRefill.service';
import questionPoolService, { getBeginnerQuizTypes, pickQuizType } from '@/core/services/english/questionPool.service';
import siblingQuestionService from '@/core/services/english/siblingQuestion.service';
import topicService from '@/core/services/english/topic.service';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import { resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';

/**
 * Nội dung beginner là bucket RIÊNG trong cùng bảng pool: chỉ topic bật cờ beginner, level
 * A1–B1, luôn 4 đáp án, loại câu bật ở beginner_quiz_types. Câu beginner và câu thường
 * không bao giờ trộn khi đếm / pop / refill. Xem docs/beginner.md.
 */

let standardTopicId: number;
let beginnerTopicId: number;

/** Thu hẹp về 1 quizType để đếm bucket bằng tay được. */
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
  standardTopicId = (await createTopic('business')).id;
  beginnerTopicId = (await createTopic('family', undefined, { forBeginner: true })).id;
});

describe('không gian bucket beginner', () => {
  it('chỉ topic bật cờ beginner mới có bucket beginner, ở level A1–B1 và luôn 4 đáp án', async () => {
    await onlyQuizType('vocab');

    const beginner = (await scanBuckets({ scope: 'all' })).filter((c) => c.forBeginner);

    expect(beginner).toHaveLength(3);
    expect(beginner.every((c) => c.topicId === beginnerTopicId)).toBe(true);
    expect(new Set(beginner.map((c) => c.engLevel))).toEqual(new Set(['A1', 'A2', 'B1']));
    expect(beginner.every((c) => c.optionCount === 4)).toBe(true);
  });

  it('bucket thường của mọi topic vẫn giữ nguyên như trước', async () => {
    await onlyQuizType('vocab');

    const standard = (await scanBuckets({ scope: 'all' })).filter((c) => !c.forBeginner);

    // 2 topic × 4 level × 1 quizType; B1/B2 vẫn 5 đáp án ở luồng thường.
    expect(standard).toHaveLength(8);
    expect(standard.find((c) => c.engLevel === 'B1')!.optionCount).toBe(5);
  });

  it('lọc audience chỉ trả đúng loại bucket được yêu cầu', async () => {
    await onlyQuizType('vocab');

    const beginnerOnly = await scanBuckets({ scope: 'all', filter: { audience: 'beginner' } });
    const standardOnly = await scanBuckets({ scope: 'all', filter: { audience: 'standard' } });

    expect(beginnerOnly.every((c) => c.forBeginner)).toBe(true);
    expect(beginnerOnly).toHaveLength(3);
    expect(standardOnly.every((c) => !c.forBeginner)).toBe(true);
    expect(standardOnly).toHaveLength(8);
  });

  it('slang và idiom mặc định không được sinh cho beginner', async () => {
    const beginnerTypes = new Set(
      (await scanBuckets({ scope: 'all', filter: { audience: 'beginner' } })).map((c) => c.quizType)
    );

    expect(beginnerTypes.has('slang')).toBe(false);
    expect(beginnerTypes.has('idiom')).toBe(false);
    expect(beginnerTypes.has('vocab')).toBe(true);
  });

  it('tắt một loại ở quiz_distribution thì beginner cũng mất loại đó (kill switch chung)', async () => {
    await onlyQuizType('vocab');

    expect(getBeginnerQuizTypes()).toEqual(['vocab']);
  });

  it('admin bật idiom cho beginner thì bucket idiom beginner xuất hiện', async () => {
    const items = getEnglishConfigSnapshot().beginner_quiz_types.map((item) =>
      item.quizType === 'idiom' ? { ...item, enabled: true } : item
    );
    await setConfig({ 'beginner_quiz_types.items': items });

    const beginner = await scanBuckets({ scope: 'all', filter: { audience: 'beginner' } });
    expect(beginner.some((c) => c.quizType === 'idiom')).toBe(true);
  });

  it('câu thường không được tính vào tồn kho của bucket beginner', async () => {
    await onlyQuizType('vocab');
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId: beginnerTopicId });

    const all = await scanBuckets({ scope: 'all' });
    const standardA1 = all.find((c) => c.topicId === beginnerTopicId && c.engLevel === 'A1' && !c.forBeginner)!;
    const beginnerA1 = all.find((c) => c.topicId === beginnerTopicId && c.engLevel === 'A1' && c.forBeginner)!;

    expect(standardA1.currentCount).toBe(3);
    expect(beginnerA1.currentCount).toBe(0);
    expect(beginnerA1.deficiency).toBe(3);
  });
});

describe('sinh câu beginner', () => {
  it('bucket beginner được sinh bằng prompt beginner và lưu cờ beginner', async () => {
    mockLLM.enqueue({ questions: [vocabQuestion(), vocabQuestion(), vocabQuestion()] });

    const result = await fillBucketDetailed({
      engLevel: 'A2',
      quizType: 'vocab',
      optionCount: 4,
      topicId: beginnerTopicId,
      topicName: 'family',
      forBeginner: true,
      count: 3,
      model: 'test/model'
    });

    expect(result.inserted).toBe(3);
    const instructions = mockLLM.lastCall()!.instructions!;
    expect(instructions).toContain('BEGINNER MODE');
    expect(instructions).not.toContain('EXPERT LEARNER MODE');

    const rows = await db.select().from(englishQuestionPool).where(eq(englishQuestionPool.topicId, beginnerTopicId));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.forBeginner)).toBe(true);
  });

  it('bucket thường vẫn sinh bằng prompt EXPERT như trước', async () => {
    mockLLM.enqueue({ questions: [vocabQuestion()] });

    await fillBucketDetailed({
      engLevel: 'A2',
      quizType: 'vocab',
      optionCount: 4,
      topicId: standardTopicId,
      topicName: 'business',
      count: 1,
      model: 'test/model'
    });

    expect(mockLLM.lastCall()!.instructions).toContain('EXPERT LEARNER MODE');
    const [row] = await db.select().from(englishQuestionPool).where(eq(englishQuestionPool.topicId, standardTopicId));
    expect(row!.forBeginner).toBe(false);
  });

  it('topic bị tắt cờ beginner sau lúc scan thì bucket beginner bị bỏ qua, không tốn LLM', async () => {
    await topicService.updateTopic(beginnerTopicId, { forBeginner: false });

    const result = await fillBucketDetailed({
      engLevel: 'A1',
      quizType: 'vocab',
      optionCount: 4,
      topicId: beginnerTopicId,
      topicName: 'family',
      forBeginner: true,
      count: 2,
      model: 'test/model'
    });

    expect(result.status).toBe('skipped');
    expect(mockLLM.callCount).toBe(0);
  });

  it('bucket beginner level B2 là không hợp lệ và bị bỏ qua', async () => {
    const result = await fillBucketDetailed({
      engLevel: 'B2',
      quizType: 'vocab',
      optionCount: 4,
      topicId: beginnerTopicId,
      topicName: 'family',
      forBeginner: true,
      count: 1,
      model: 'test/model'
    });

    expect(result.status).toBe('skipped');
    expect(mockLLM.callCount).toBe(0);
  });

  it('bucket beginner đầy không chặn bucket thường cùng tổ hợp và ngược lại', async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId: beginnerTopicId, forBeginner: true });

    const inserted = await questionPoolService.pushQuestions([
      {
        quizType: 'vocab',
        engLevel: 'A1',
        optionCount: 4,
        questionData: JSON.stringify(vocabQuestion()),
        model: 'test/model',
        tokenIn: 1,
        tokenOut: 1,
        topicId: beginnerTopicId
      },
      {
        quizType: 'vocab',
        engLevel: 'A1',
        optionCount: 4,
        questionData: JSON.stringify(vocabQuestion()),
        model: 'test/model',
        tokenIn: 1,
        tokenOut: 1,
        topicId: beginnerTopicId,
        forBeginner: true
      }
    ]);

    // Chỉ câu thường vào được — bucket beginner đã đủ maxPerBucket.
    expect(inserted).toBe(1);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', beginnerTopicId, true)).toBe(3);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', beginnerTopicId, false)).toBe(1);
  });
});

describe('phục vụ câu beginner', () => {
  it('pop mặc định không bao giờ trả câu beginner', async () => {
    const beginnerIds = await seedPoolQuestions(3, {
      engLevel: 'A1',
      quizType: 'vocab',
      topicId: beginnerTopicId,
      forBeginner: true
    });
    const standardId = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId: beginnerTopicId });

    for (let i = 0; i < 10; i += 1) {
      const popped = await questionPoolService.popQuestion('A1', beginnerTopicId);
      expect(popped!.id).toBe(standardId);
      expect(beginnerIds).not.toContain(popped!.id);
    }
  });

  it('pop beginner chỉ trả câu beginner', async () => {
    const beginnerIds = await seedPoolQuestions(2, {
      engLevel: 'A1',
      quizType: 'vocab',
      topicId: beginnerTopicId,
      forBeginner: true
    });
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId: beginnerTopicId });

    for (let i = 0; i < 10; i += 1) {
      const popped = await questionPoolService.popQuestion('A1', beginnerTopicId, [], null, true);
      expect(beginnerIds).toContain(popped!.id);
      expect(popped!.forBeginner).toBe(true);
    }
  });

  it('chọn loại câu cho beginner chỉ bốc trong các loại đang bật cho beginner', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect(['slang', 'idiom']).not.toContain(pickQuizType({ forBeginner: true }));
    }
  });

  it('không loại câu nào bật cho beginner thì chọn loại beginner báo lỗi nghiệp vụ', async () => {
    const items = getEnglishConfigSnapshot().beginner_quiz_types.map((item) => ({ ...item, enabled: false }));
    await setConfig({ 'beginner_quiz_types.items': items });

    expect(() => pickQuizType({ forBeginner: true })).toThrow(BusinessLogicException);
  });
});

describe('admin đánh dấu câu beginner', () => {
  it('câu A2 bốn đáp án chuyển sang bucket beginner', async () => {
    const id = await seedPoolQuestion({ engLevel: 'A2', quizType: 'vocab', topicId: beginnerTopicId });

    const updated = await questionPoolService.setQuestionForBeginner(id, true);

    expect(updated.forBeginner).toBe(true);
    expect(await questionPoolService.getPoolCount('A2', 'vocab', beginnerTopicId, true)).toBe(1);
    expect(await questionPoolService.getPoolCount('A2', 'vocab', beginnerTopicId, false)).toBe(0);
  });

  it('câu B2 không được đánh dấu beginner', async () => {
    const id = await seedPoolQuestion({ engLevel: 'B2', quizType: 'vocab', optionCount: 5, topicId: beginnerTopicId });

    await expect(questionPoolService.setQuestionForBeginner(id, true)).rejects.toThrow(BusinessLogicException);
  });

  it('câu 5 đáp án không được đánh dấu beginner', async () => {
    const id = await seedPoolQuestion({ engLevel: 'B1', quizType: 'vocab', optionCount: 5, topicId: beginnerTopicId });

    await expect(questionPoolService.setQuestionForBeginner(id, true)).rejects.toThrow(BusinessLogicException);
  });

  it('loại câu chưa bật cho beginner không được đánh dấu', async () => {
    const id = await seedPoolQuestion({ engLevel: 'A1', quizType: 'slang', topicId: beginnerTopicId });

    await expect(questionPoolService.setQuestionForBeginner(id, true)).rejects.toThrow(BusinessLogicException);
  });

  it('bỏ đánh dấu luôn được phép, câu về lại bucket thường', async () => {
    const id = await seedPoolQuestion({ engLevel: 'A1', topicId: beginnerTopicId, forBeginner: true });

    const updated = await questionPoolService.setQuestionForBeginner(id, false);
    expect(updated.forBeginner).toBe(false);
  });
});

describe('câu tương tự kế thừa chuẩn beginner của câu gốc', () => {
  it('sibling của câu beginner cũng là câu beginner và được sinh theo chuẩn beginner', async () => {
    const sourceId = await seedPoolQuestion({
      engLevel: 'A1',
      quizType: 'vocab',
      topicId: beginnerTopicId,
      forBeginner: true
    });
    mockLLM.enqueue({
      questions: [
        vocabQuestion({
          overrides: {
            wrongAnswers: ['lười 1', 'hấp tấp 1', 'thờ ơ 1'],
            wrongAnswerExplanations: ['sai 1a', 'sai 1b', 'sai 1c'],
            exampleSentence: 'A brand new sentence number 1.',
            exampleTranslation: 'Câu ví dụ mới số 1.'
          }
        })
      ]
    });

    const result = await siblingQuestionService.generateSiblingsForSource(sourceId, {
      count: 1,
      context: 'manual',
      forceInsert: true
    });

    expect(result.inserted).toBe(1);
    expect(mockLLM.lastCall()!.instructions).toContain('beginner track');
    const sibling = await questionPoolService.getPoolQuestionById(result.poolQuestionIds[0]!);
    expect(sibling!.forBeginner).toBe(true);
  });
});
