import { beforeEach, describe, expect, it } from 'bun:test';
import questionPoolService from '@/core/services/english/questionPool.service';
import { bucketKeyOf } from '@/core/services/english/poolRefill.service';
import { countRows, resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';

let topicId: number;
let otherTopicId: number;

beforeEach(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
  otherTopicId = (await createTopic('travel')).id;
});

function pushInput(overrides: Record<string, unknown> = {}) {
  return {
    quizType: 'vocab' as const,
    engLevel: 'A1',
    optionCount: 4,
    questionData: JSON.stringify(vocabQuestion()),
    model: 'test/model',
    tokenIn: 10,
    tokenOut: 5,
    topicId,
    ...overrides
  };
}

describe('pushQuestions — trần maxPerBucket được enforce lúc GHI', () => {
  it('bucket rỗng nhận đủ số câu trong giới hạn', async () => {
    const inserted = await questionPoolService.pushQuestions([pushInput(), pushInput()]);
    expect(inserted).toBe(2);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(2);
  });

  it('bucket đã đầy -> bỏ qua, KHÔNG overwrite câu cũ', async () => {
    // maxPerBucket mặc định = 3
    const existingIds = await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });

    const inserted = await questionPoolService.pushQuestions([pushInput(), pushInput()]);

    expect(inserted).toBe(0);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(3);
    // Câu cũ vẫn còn nguyên.
    for (const id of existingIds) {
      expect(await questionPoolService.getPoolQuestionById(id)).not.toBeNull();
    }
  });

  it('bucket còn 1 chỗ + đẩy 3 câu -> chỉ nhận 1', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });

    const inserted = await questionPoolService.pushQuestions([pushInput(), pushInput(), pushInput()]);

    expect(inserted).toBe(1);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(3);
  });

  it('mỗi bucket có hạn mức riêng trong cùng một batch', async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId }); // đầy
    // Batch chạm 3 bucket: một đầy, hai còn trống.
    const inserted = await questionPoolService.pushQuestions([
      pushInput(),
      pushInput({ engLevel: 'B1', optionCount: 5 }),
      pushInput({ topicId: otherTopicId })
    ]);

    expect(inserted).toBe(2);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', topicId)).toBe(3);
    expect(await questionPoolService.getPoolCount('B1', 'vocab', topicId)).toBe(1);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', otherTopicId)).toBe(1);
  });

  it('tôn trọng maxPerBucket sau khi admin đổi config', async () => {
    await setConfig({ 'question_pool.maxPerBucket': 1 });

    const inserted = await questionPoolService.pushQuestions([pushInput(), pushInput()]);
    expect(inserted).toBe(1);
  });

  it('bucket "không topic" (topicId = null) là bucket riêng, không dùng chung hạn mức', async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId }); // topic đầy

    const inserted = await questionPoolService.pushQuestions([pushInput({ topicId: null })]);

    expect(inserted).toBe(1);
    expect(await questionPoolService.getPoolCount('A1', 'vocab', null)).toBe(1);
  });

  it('mảng rỗng -> 0, không mở transaction thừa', async () => {
    expect(await questionPoolService.pushQuestions([])).toBe(0);
  });
});

describe('popQuestion — KHÔNG phá huỷ (pool là kho dùng lại được)', () => {
  it('pop không xoá và không đánh dấu row', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', topicId });
    const before = await countRows('english_question_pool');

    const first = await questionPoolService.popQuestion('A1', topicId);
    const second = await questionPoolService.popQuestion('A1', topicId);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await countRows('english_question_pool')).toBe(before);
  });

  it('cùng một câu có thể được trả lại ở lần pop sau', async () => {
    await seedPoolQuestion({ engLevel: 'A1', topicId });

    const a = await questionPoolService.popQuestion('A1', topicId);
    const b = await questionPoolService.popQuestion('A1', topicId);

    expect(a?.id).toBe(b!.id);
  });

  it('bucket rỗng -> null', async () => {
    expect(await questionPoolService.popQuestion('A1', topicId)).toBeNull();
  });

  it('excludeIds loại đúng câu đã thấy', async () => {
    const ids = await seedPoolQuestions(3, { engLevel: 'A1', topicId });

    const picked = await questionPoolService.popQuestion('A1', topicId, [ids[0]!, ids[1]!]);
    expect(picked?.id).toBe(ids[2]!);
  });

  it('loại hết câu trong bucket -> null (client tự quyết định pop lại)', async () => {
    const ids = await seedPoolQuestions(2, { engLevel: 'A1', topicId });
    expect(await questionPoolService.popQuestion('A1', topicId, ids)).toBeNull();
  });

  it('không lẫn câu giữa các engLevel / topic khác nhau', async () => {
    const a1 = await seedPoolQuestion({ engLevel: 'A1', topicId });
    await seedPoolQuestion({ engLevel: 'B2', topicId, optionCount: 5 });
    await seedPoolQuestion({ engLevel: 'A1', topicId: otherTopicId });

    for (let i = 0; i < 10; i += 1) {
      expect((await questionPoolService.popQuestion('A1', topicId))?.id).toBe(a1);
    }
  });

  it('topicId = null chỉ lấy câu không topic', async () => {
    const noTopic = await seedPoolQuestion({ engLevel: 'A1', topicId: null });
    await seedPoolQuestion({ engLevel: 'A1', topicId });

    for (let i = 0; i < 10; i += 1) {
      expect((await questionPoolService.popQuestion('A1', null))?.id).toBe(noTopic);
    }
  });
});

describe('getPoolCountsByBucket — khoá phải khớp bucketKeyOf', () => {
  it('key sinh từ SQL trùng khít key sinh từ poolRefill.bucketKeyOf', async () => {
    // Đây là điểm nối giữa 2 module khác file; lệch format = scan luôn đọc count 0.
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestion({ engLevel: 'B1', quizType: 'idiom', topicId: null, optionCount: 5 });

    const counts = await questionPoolService.getPoolCountsByBucket();

    expect(counts.get(bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' }))).toBe(2);
    expect(counts.get(bucketKeyOf({ engLevel: 'B1', topicId: null, quizType: 'idiom' }))).toBe(1);
  });

  it('bucket không có câu thì vắng mặt khỏi map (caller tự ?? 0)', async () => {
    const counts = await questionPoolService.getPoolCountsByBucket();
    expect(counts.get(bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' }))).toBeUndefined();
  });
});

describe('getSiblingSourceCountsByBucket — chỉ đếm câu gốc', () => {
  it('bỏ qua câu là sibling (sourceQuestionId IS NOT NULL)', async () => {
    const sourceId = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId, sourceQuestionId: sourceId });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId, sourceQuestionId: sourceId });

    const all = await questionPoolService.getPoolCountsByBucket();
    const sources = await questionPoolService.getSiblingSourceCountsByBucket();
    const key = bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' });

    expect(all.get(key)).toBe(3);
    expect(sources.get(key)).toBe(1);
  });
});

describe('pickSiblingSourceIds — không sinh sibling từ sibling', () => {
  it('chỉ trả câu gốc', async () => {
    const sourceId = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId, sourceQuestionId: sourceId });

    const picked = await questionPoolService.pickSiblingSourceIds('A1', 'vocab', topicId, 10);
    expect(picked).toEqual([sourceId]);
  });

  it('limit <= 0 -> mảng rỗng, không query', async () => {
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    expect(await questionPoolService.pickSiblingSourceIds('A1', 'vocab', topicId, 0)).toEqual([]);
  });
});
