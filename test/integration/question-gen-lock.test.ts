import { beforeEach, describe, expect, it } from 'bun:test';
import { processQuestionGenJob } from '@/core/cron/question-gen.job';
import { getMaxPoolSize } from '@/core/services/english/questionPool.service';
import { resetDb } from '../helpers/db.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestions } from '../helpers/seed.helper';
import { testRedis } from '../setup';

/**
 * Lock `question-pool:lock:<lvl>:<topic>:<type>` chỉ do luồng sibling (cron + manual bulk) SET
 * (NX, 300s) để 2 lượt sibling không cùng xử lý 1 bucket. Job question-gen không hề giữ lock
 * này, nên không được phép xoá nó — nếu xoá, một lượt sibling khác sẽ chen vào bucket đang
 * được xử lý.
 */
describe('question-gen job và lock sibling', () => {
  let topicId: number;

  beforeEach(async () => {
    await resetDb();
    mockLLM.reset();
    await testRedis.flushall();
    topicId = (await createTopic('daily-life')).id;
  });

  it('không nhả lock mà lượt sibling đang giữ trên cùng bucket', async () => {
    // Bucket đầy -> job không gọi LLM, chỉ còn phần dọn dẹp cuối job.
    await seedPoolQuestions(getMaxPoolSize(), { engLevel: 'A1', quizType: 'vocab', topicId });
    const lockKey = `question-pool:lock:A1:${topicId}:vocab`;
    await testRedis.set(lockKey, '1', 'EX', 300, 'NX');

    await processQuestionGenJob(
      { engLevel: 'A1', quizType: 'vocab', optionCount: 4, topicId, topicName: 'daily-life', count: 1 },
      null
    );

    expect(await testRedis.exists(lockKey)).toBe(1);
    expect(mockLLM.callCount).toBe(0);
  });
});
