export type EnglishCronJobStatus = 'running' | 'success' | 'partial_success' | 'failed' | 'skipped';

export interface RunStatusCounts {
  runningBuckets: number;
  failedBuckets: number;
  succeededBuckets: number;
  skippedBuckets: number;
  totalBuckets: number;
  /** Số bucket được plan lúc bắt đầu run — phân biệt "không có gì để làm" với "đã làm xong". */
  deficientBuckets: number;
}

/**
 * Roll-up trạng thái của cả run từ trạng thái các bucket con.
 *
 * Thứ tự nhánh là một phần của hợp đồng:
 *  - còn bucket `running` thì run chưa kết thúc, kể cả khi đã có bucket fail;
 *  - fail + có ít nhất 1 success/skip = `partial_success` (không phải `failed`);
 *  - run không có bucket nào: `skipped` nếu lúc scan vốn đã không thiếu bucket nào,
 *    ngược lại `success` (đã plan nhưng bucket bị lọc hết ở tầng dưới).
 */
export function deriveRunStatus(counts: RunStatusCounts): EnglishCronJobStatus {
  if (counts.runningBuckets > 0) return 'running';
  if (counts.failedBuckets > 0 && counts.succeededBuckets + counts.skippedBuckets > 0) return 'partial_success';
  if (counts.failedBuckets > 0) return 'failed';
  if (counts.succeededBuckets === 0 && counts.skippedBuckets > 0) return 'skipped';
  if (counts.totalBuckets === 0) return counts.deficientBuckets === 0 ? 'skipped' : 'success';
  return 'success';
}
