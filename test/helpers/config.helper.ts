import {
  getEnglishConfigSnapshot,
  updateEnglishConfigBulk,
  type EnglishConfigChange
} from '@/core/services/english/englishConfig.service';
import type { EnglishConfigSnapshot } from '@/core/services/english/englishConfig.defaults';

/**
 * Đổi config runtime trong test. Luôn đi qua updateEnglishConfigBulk (không UPDATE thẳng DB)
 * để giữ đúng đường thật: validate chéo + refresh snapshot + chạy change hook.
 *
 * Bulk 1 lần cho tất cả thay đổi là bắt buộc với các cặp ràng buộc chéo
 * (vd manualFillMinCount <= manualFillDefaultCount) — sửa lần lượt sẽ fail giữa chừng.
 */
export async function setConfig(changes: Record<string, unknown>): Promise<void> {
  const payload: EnglishConfigChange[] = Object.entries(changes).map(([recordKey, value]) => ({ recordKey, value }));
  await updateEnglishConfigBulk(payload);
}

export function snapshot(): EnglishConfigSnapshot {
  return getEnglishConfigSnapshot();
}

/** Tắt hết job flag — test không bao giờ muốn cron/worker tự chạy xen vào. */
export async function disableAllJobs(): Promise<void> {
  await setConfig({
    'job_flags.questionGenEnabled': false,
    'job_flags.poolRefillEnabled': false,
    'job_flags.siblingGenEnabled': false,
    'job_flags.readingRefillEnabled': false,
    'job_flags.readingQuestionRefillEnabled': false
  });
}
