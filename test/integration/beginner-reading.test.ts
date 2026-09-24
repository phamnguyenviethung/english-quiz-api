import { beforeEach, describe, expect, it } from 'bun:test';
import { BusinessLogicException } from '@/core/exceptions';
import { fillReadingBucketDetailed } from '@/core/cron/reading-gen.job';
import { scanReadingBuckets } from '@/core/services/english/readingRefill.service';
import readingPassageService from '@/core/services/english/readingPassage.service';
import readingQuestionService from '@/core/services/english/readingQuestion.service';
import { resetDb } from '../helpers/db.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPassage, seedReadyPassage } from '../helpers/seed.helper';
import { readingPassage } from '../fixtures/reading.fixture';

/**
 * Bài đọc beginner: chỉ topic bật cờ beginner, level A1–B1, chỉ type 'daily', sinh bằng
 * prompt beginner. Câu hỏi của bài mang cùng cờ. Tenant không truyền beginner thì không
 * bao giờ nhận bài beginner và ngược lại. Xem docs/beginner.md.
 */

let standardTopicId: number;
let beginnerTopicId: number;

beforeEach(async () => {
  await resetDb();
  mockLLM.reset();
  standardTopicId = (await createTopic('economy')).id;
  beginnerTopicId = (await createTopic('family', undefined, { forBeginner: true })).id;
});

describe('không gian bucket bài đọc beginner', () => {
  it('chỉ topic beginner có bucket beginner, ở A1–B1 và chỉ type daily', async () => {
    const beginner = await scanReadingBuckets({ scope: 'all', filter: { audience: 'beginner' } });

    expect(beginner).toHaveLength(3);
    expect(beginner.every((c) => c.forBeginner && c.topicId === beginnerTopicId && c.type === 'daily')).toBe(true);
    expect(new Set(beginner.map((c) => c.cefrLevel))).toEqual(new Set(['A1', 'A2', 'B1']));
  });

  it('bucket thường của mọi topic giữ nguyên (4 level × 2 type)', async () => {
    const standard = await scanReadingBuckets({ scope: 'all', filter: { audience: 'standard' } });

    expect(standard).toHaveLength(2 * 4 * 2);
    expect(standard.every((c) => !c.forBeginner)).toBe(true);
  });

  it('bài thường không được tính vào tồn kho bucket beginner', async () => {
    await seedPassage({ cefrLevel: 'A1', topicId: beginnerTopicId, type: 'daily' });

    const beginnerA1 = (await scanReadingBuckets({ scope: 'all', filter: { audience: 'beginner' } })).find(
      (c) => c.cefrLevel === 'A1'
    )!;

    expect(beginnerA1.currentCount).toBe(0);
  });
});

describe('sinh bài đọc beginner', () => {
  it('bài beginner được sinh bằng prompt beginner và lưu cờ beginner', async () => {
    mockLLM.enqueue({ passages: [readingPassage(1)] });

    const result = await fillReadingBucketDetailed({
      cefrLevel: 'A1',
      topicId: beginnerTopicId,
      topicName: 'family',
      type: 'daily',
      forBeginner: true,
      count: 1,
      model: 'test/model'
    });

    expect(result.inserted).toBe(1);
    expect(mockLLM.lastCall()!.instructions).toContain('BEGINNER TRACK');

    const page = await readingPassageService.listPassages({ topicId: beginnerTopicId });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.forBeginner).toBe(true);
  });

  it('topic đã tắt cờ beginner thì bucket beginner bị bỏ qua, không tốn LLM', async () => {
    const result = await fillReadingBucketDetailed({
      cefrLevel: 'A1',
      topicId: standardTopicId,
      topicName: 'economy',
      type: 'daily',
      forBeginner: true,
      count: 1,
      model: 'test/model'
    });

    expect(result.status).toBe('skipped');
    expect(mockLLM.callCount).toBe(0);
  });
});

describe('phục vụ bài đọc beginner', () => {
  it('pop beginner chỉ trả bài beginner, pop thường chỉ trả bài thường', async () => {
    const beginnerId = await seedReadyPassage({ cefrLevel: 'A1', topicId: beginnerTopicId, forBeginner: true });
    const standardId = await seedReadyPassage({ cefrLevel: 'A1', topicId: beginnerTopicId });

    for (let i = 0; i < 5; i += 1) {
      const beginner = await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', forBeginner: true });
      const standard = await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', forBeginner: false });
      expect(beginner!.passage.id).toBe(beginnerId);
      expect(beginner!.passage.forBeginner).toBe(true);
      expect(standard!.passage.id).toBe(standardId);
    }
  });

  it('đếm bài sẵn sàng tách riêng beginner và thường', async () => {
    await seedReadyPassage({ cefrLevel: 'A2', topicId: beginnerTopicId, forBeginner: true });
    await seedReadyPassage({ cefrLevel: 'A2', topicId: beginnerTopicId });
    await seedReadyPassage({ cefrLevel: 'A2', topicId: beginnerTopicId });

    expect(await readingQuestionService.countReadyPassages({ cefrLevel: 'A2', forBeginner: true })).toBe(1);
    expect(await readingQuestionService.countReadyPassages({ cefrLevel: 'A2', forBeginner: false })).toBe(2);
  });
});

describe('admin đánh dấu bài đọc beginner', () => {
  it('đánh dấu bài beginner kéo theo mọi câu hỏi của bài', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A2', topicId: beginnerTopicId });

    const updated = await readingPassageService.updatePassage(passageId, { forBeginner: true });

    expect(updated.forBeginner).toBe(true);
    const questions = await readingQuestionService.listQuestions({ passageId });
    expect(questions.items.every((q) => q.forBeginner)).toBe(true);
    expect(await readingQuestionService.popPassageWithQuestions({ forBeginner: true })).not.toBeNull();
  });

  it('bài B2 không được đánh dấu beginner', async () => {
    const passageId = await seedPassage({ cefrLevel: 'B2', topicId: beginnerTopicId });

    await expect(readingPassageService.updatePassage(passageId, { forBeginner: true })).rejects.toThrow(
      BusinessLogicException
    );
  });

  it('bài academic không được đánh dấu beginner', async () => {
    const passageId = await seedPassage({ cefrLevel: 'A1', topicId: beginnerTopicId, type: 'academic' });

    await expect(readingPassageService.updatePassage(passageId, { forBeginner: true })).rejects.toThrow(
      BusinessLogicException
    );
  });
});
