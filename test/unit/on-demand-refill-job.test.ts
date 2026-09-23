import { describe, expect, it } from 'bun:test';
import { buildOnDemandRefillJob } from '@/core/services/english/poolRefill.service';

/**
 * Refill on-demand phải chống trùng theo bucket nhưng KHÔNG được khoá bucket sau khi job fail.
 * `jobId` cố định + `removeOnFail: 100` giữ job fail lại trong failed set → BullMQ bỏ qua mọi
 * `add` cùng id → bucket không bao giờ được refill on-demand nữa. Deduplication id thì được nhả
 * ngay khi job completed hoặc failed.
 */
describe('buildOnDemandRefillJob', () => {
  const input = {
    engLevel: 'A2' as const,
    topicId: 5,
    topicName: 'Food',
    quizType: 'vocab' as const,
    optionCount: 4 as const
  };

  it('chống trùng theo bucket bằng deduplication id, không dùng jobId cố định', () => {
    const job = buildOnDemandRefillJob(input, 3);

    expect(job.opts.deduplication).toEqual({ id: 'refill_A2_5_vocab' });
    expect((job.opts as Record<string, unknown>).jobId).toBeUndefined();
  });

  it('bucket không topic có key riêng', () => {
    expect(buildOnDemandRefillJob({ ...input, topicId: null, topicName: null }, 2).opts.deduplication).toEqual({
      id: 'refill_A2_null_vocab'
    });
  });

  it('job mang đúng bucket và số câu cần bù', () => {
    const job = buildOnDemandRefillJob(input, 3);

    expect(job.name).toBe('refill');
    expect(job.data).toEqual({ engLevel: 'A2', quizType: 'vocab', optionCount: 4, topicId: 5, topicName: 'Food', count: 3 });
  });
});
