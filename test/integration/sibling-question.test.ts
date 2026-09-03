import { beforeEach, describe, expect, it } from 'bun:test';
import siblingQuestionService, { SIBLING_MAX_PER_CALL } from '@/core/services/english/siblingQuestion.service';
import questionPoolService from '@/core/services/english/questionPool.service';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { countRows, resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';

let topicId: number;

beforeEach(async () => {
  await resetDb();
  mockLLM.reset();
  topicId = (await createTopic('daily-life')).id;
});

/** Sibling hợp lệ: giữ field khóa (`word`, `partOfSpeech`), đổi hẳn ngữ cảnh. */
function validSibling(index: number): Record<string, unknown> {
  return vocabQuestion({
    overrides: {
      wrongAnswers: [`lười ${index}`, `hấp tấp ${index}`, `thờ ơ ${index}`],
      wrongAnswerExplanations: [`sai ${index}a`, `sai ${index}b`, `sai ${index}c`],
      exampleSentence: `A brand new sentence number ${index}.`,
      exampleTranslation: `Câu ví dụ mới số ${index}.`
    }
  });
}

async function generate(sourceId: number, count: number, forceInsert = true) {
  return siblingQuestionService.generateSiblingsForSource(sourceId, {
    count,
    context: 'manual',
    forceInsert
  });
}

describe('kiểm tra đầu vào (throw, khác với lỗi từng candidate)', () => {
  it('câu gốc không tồn tại -> NotFoundException', async () => {
    expect(generate(999999, 1)).rejects.toThrow(NotFoundException);
    expect(mockLLM.callCount).toBe(0);
  });

  it('quizType không hỗ trợ -> BusinessLogicException, không gọi LLM', async () => {
    const id = await seedPoolQuestion({ quizType: 'vocab', topicId });
    // odd-one-out không nằm trong SIBLING_SUPPORTED_QUIZ_TYPES
    const db = (await import('@/configs/orm.config')).default;
    const { englishQuestionPool } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    await db.update(englishQuestionPool).set({ quizType: 'odd-one-out' }).where(eq(englishQuestionPool.id, id));

    expect(generate(id, 1)).rejects.toThrow(BusinessLogicException);
    expect(mockLLM.callCount).toBe(0);
  });

  it('questionData không phải JSON hợp lệ -> BusinessLogicException', async () => {
    const id = await seedPoolQuestion({ quizType: 'vocab', topicId });
    const db = (await import('@/configs/orm.config')).default;
    const { englishQuestionPool } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    await db.update(englishQuestionPool).set({ questionData: 'khong-phai-json' }).where(eq(englishQuestionPool.id, id));

    expect(generate(id, 1)).rejects.toThrow(BusinessLogicException);
  });
});

describe('đường thành công', () => {
  it('ghi sibling vào pool với sourceQuestionId trỏ đúng câu gốc', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    mockLLM.enqueue({ questions: [validSibling(1), validSibling(2)] });

    const result = await generate(sourceId, 2);

    expect(result.generated).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.poolQuestionIds).toHaveLength(2);

    for (const id of result.poolQuestionIds) {
      const row = await questionPoolService.getPoolQuestionById(id);
      expect(row?.sourceQuestionId).toBe(sourceId);
      expect(row?.quizType).toBe('vocab');
      expect(row?.engLevel).toBe('A1');
      expect(row?.topicId).toBe(topicId);
    }
  });

  it('token được chia đều cho các candidate hợp lệ', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1), validSibling(2)] }, { inputTokens: 300, outputTokens: 100 });

    const result = await generate(sourceId, 2);

    expect(result.tokenIn).toBe(300);
    const first = await questionPoolService.getPoolQuestionById(result.poolQuestionIds[0]!);
    expect(first?.tokenIn).toBe(150);
    expect(first?.tokenOut).toBe(50);
  });

  it('count bị kẹp về trần 5 của batch schema', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });

    const result = await generate(sourceId, 99);

    expect(result.requested).toBe(SIBLING_MAX_PER_CALL);
  });

  it('prompt mang theo giá trị field khóa của câu gốc', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });

    await generate(sourceId, 1);

    const call = mockLLM.lastCall()!;
    expect(call.instructions).toContain('diligent'); // field khóa `word`
    expect(call.temperature).toBe(0.7);
  });
});

describe('lỗi từng candidate không làm hỏng cả lượt', () => {
  it('candidate trùng ngữ cảnh câu gốc bị loại, candidate tốt vẫn được ghi', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [vocabQuestion(), validSibling(2)] });

    const result = await generate(sourceId, 2);

    expect(result.generated).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.warnings.some((w) => w.includes('Ngữ cảnh trùng câu gốc'))).toBe(true);
  });

  it('model đổi field khóa -> khôi phục + warning, vẫn ghi vào pool', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({
      questions: [vocabQuestion({ overrides: { ...validSibling(1), word: 'lazy' } })]
    });

    const result = await generate(sourceId, 1);

    expect(result.inserted).toBe(1);
    expect(result.warnings.some((w) => w.includes('word'))).toBe(true);

    const written = await questionPoolService.getPoolQuestionById(result.poolQuestionIds[0]!);
    expect(JSON.parse(written!.questionData).word).toBe('diligent');
  });

  it('candidate sai độ dài mảng bị loại', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({
      questions: [vocabQuestion({ overrides: { ...validSibling(1), wrongAnswers: ['chỉ một'] } })]
    });

    const result = await generate(sourceId, 1);

    expect(result.failed).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('model trả mảng rỗng -> generated 0, không throw', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueueRaw({ questions: [] });

    const result = await generate(sourceId, 2);

    expect(result.generated).toBe(0);
    expect(result.inserted).toBe(0);
  });

  it('LLM throw -> bọc thành BusinessLogicException, pool không đổi', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    const before = await countRows('english_question_pool');
    mockLLM.fail(new Error('OpenRouter 500'));

    expect(generate(sourceId, 1)).rejects.toThrow(BusinessLogicException);
    expect(await countRows('english_question_pool')).toBe(before);
  });
});

describe('trần pool khi ghi sibling', () => {
  it('forceInsert = false tôn trọng maxPerBucket -> phần thừa tính vào skipped', async () => {
    // Bucket đã có 2 câu (1 gốc + 1 nữa), maxPerBucket = 3 -> chỉ còn 1 chỗ.
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    mockLLM.enqueue({ questions: [validSibling(1), validSibling(2), validSibling(3)] });

    const result = await generate(sourceId, 3, false);

    expect(result.generated).toBe(3);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(2);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(3);
  });

  it('forceInsert = true bỏ qua trần (admin chủ động)', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    await seedPoolQuestions(2, { quizType: 'vocab', engLevel: 'A1', topicId }); // bucket đã đầy
    mockLLM.enqueue({ questions: [validSibling(1), validSibling(2)] });

    const result = await generate(sourceId, 2, true);

    expect(result.inserted).toBe(2);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(5);
  });

  it('bucket đầy + forceInsert = false -> không ghi câu nào', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    await seedPoolQuestions(2, { quizType: 'vocab', engLevel: 'A1', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });

    const result = await generate(sourceId, 1, false);

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('guard chống double-submit', () => {
  it('hai lời gọi song song cùng sourceId -> một cái bị từ chối', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });
    mockLLM.enqueue({ questions: [validSibling(2)] });

    const results = await Promise.allSettled([generate(sourceId, 1), generate(sourceId, 1)]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BusinessLogicException);
  });

  it('guard được nhả sau khi xong — gọi lại vẫn chạy được', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });
    await generate(sourceId, 1);

    mockLLM.enqueue({ questions: [validSibling(2)] });
    const second = await generate(sourceId, 1);

    expect(second.inserted).toBe(1);
  });
});

describe('quan hệ với câu gốc', () => {
  it('xoá câu gốc -> sibling VẪN CÒN, sourceQuestionId về null (ON DELETE SET NULL)', async () => {
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });
    const { poolQuestionIds } = await generate(sourceId, 1);
    const siblingId = poolQuestionIds[0]!;

    const db = (await import('@/configs/orm.config')).default;
    const { englishQuestionPool } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    await db.delete(englishQuestionPool).where(eq(englishQuestionPool.id, sourceId));

    const sibling = await questionPoolService.getPoolQuestionById(siblingId);
    expect(sibling).not.toBeNull();
    expect(sibling?.sourceQuestionId).toBeNull();
  });

  it('maxPerBucket đổi qua config được tôn trọng ngay', async () => {
    await setConfig({ 'question_pool.maxPerBucket': 1 });
    const sourceId = await seedPoolQuestion({ quizType: 'vocab', engLevel: 'A1', topicId });
    mockLLM.enqueue({ questions: [validSibling(1)] });

    const result = await generate(sourceId, 1, false);

    expect(result.inserted).toBe(0); // bucket đã có đúng 1 câu (chính câu gốc)
  });
});
