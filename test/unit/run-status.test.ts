import { describe, expect, it } from 'bun:test';
import { deriveRunStatus, type RunStatusCounts } from '@/core/services/english/cronRunStatus';

function counts(overrides: Partial<RunStatusCounts> = {}): RunStatusCounts {
  return {
    runningBuckets: 0,
    failedBuckets: 0,
    succeededBuckets: 0,
    skippedBuckets: 0,
    totalBuckets: 0,
    deficientBuckets: 0,
    ...overrides
  };
}

/**
 * Trạng thái run là thứ admin nhìn để biết một lượt refill có cần chạy lại không.
 * Thứ tự các nhánh chính là hợp đồng — đặc biệt "còn running thì chưa kết luận".
 */
describe('deriveRunStatus', () => {
  it('còn bucket đang chạy -> running, kể cả khi đã có bucket fail', () => {
    expect(deriveRunStatus(counts({ runningBuckets: 1, failedBuckets: 2, totalBuckets: 3 }))).toBe('running');
  });

  it('fail + có ít nhất 1 success -> partial_success (không phải failed)', () => {
    expect(deriveRunStatus(counts({ failedBuckets: 1, succeededBuckets: 1, totalBuckets: 2 }))).toBe('partial_success');
  });

  it('fail + có skip cũng tính là partial_success', () => {
    expect(deriveRunStatus(counts({ failedBuckets: 1, skippedBuckets: 1, totalBuckets: 2 }))).toBe('partial_success');
  });

  it('chỉ toàn fail -> failed', () => {
    expect(deriveRunStatus(counts({ failedBuckets: 3, totalBuckets: 3 }))).toBe('failed');
  });

  it('không success nào nhưng có skip -> skipped', () => {
    expect(deriveRunStatus(counts({ skippedBuckets: 2, totalBuckets: 2 }))).toBe('skipped');
  });

  it('toàn success -> success', () => {
    expect(deriveRunStatus(counts({ succeededBuckets: 3, totalBuckets: 3 }))).toBe('success');
  });

  it('success + skip (không fail) -> success', () => {
    expect(deriveRunStatus(counts({ succeededBuckets: 1, skippedBuckets: 1, totalBuckets: 2 }))).toBe('success');
  });

  it('không có bucket nào và lúc scan cũng không thiếu -> skipped ("không có gì để làm")', () => {
    expect(deriveRunStatus(counts({ totalBuckets: 0, deficientBuckets: 0 }))).toBe('skipped');
  });

  it('không có bucket nào nhưng lúc scan có thiếu -> success', () => {
    expect(deriveRunStatus(counts({ totalBuckets: 0, deficientBuckets: 5 }))).toBe('success');
  });
});
