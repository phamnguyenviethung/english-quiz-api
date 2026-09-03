import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ensureEnglishConfigSeeded,
  getAllEnglishConfigRows,
  getEnglishConfigByKey,
  getEnglishConfigSnapshot,
  onEnglishConfigChanged,
  refreshEnglishConfig,
  resetEnglishConfigToDefault,
  updateEnglishConfig,
  updateEnglishConfigBulk
} from '@/core/services/english/englishConfig.service';
import { getRefillThreshold, getMaxPoolSize } from '@/core/services/english/questionPool.service';
import { BusinessLogicException } from '@/core/exceptions';
import { resetDb } from '../helpers/db.helper';

beforeEach(async () => {
  await resetDb();
});

describe('seed + snapshot', () => {
  it('seed idempotent — chạy lại không nhân bản record', async () => {
    const before = await getAllEnglishConfigRows();
    await ensureEnglishConfigSeeded();
    const after = await getAllEnglishConfigRows();

    expect(after).toHaveLength(before.length);
    expect(before.length).toBeGreaterThan(0);
  });

  it('mỗi record mang đủ metadata cho admin UI', async () => {
    const row = await getEnglishConfigByKey('question_pool.maxPerBucket');

    expect(row).not.toBeNull();
    expect(row!.value).toBe(3);
    expect(row!.defaultValue).toBe(3);
    expect(row!.recordType).toBe('num');
    expect(row!.validation).toBeDefined();
    expect(row!.uiSchema).toBeDefined();
  });

  it('recordKey không tồn tại -> null', async () => {
    expect(await getEnglishConfigByKey('khong.ton.tai')).toBeNull();
  });
});

describe('updateEnglishConfig — một record', () => {
  it('cập nhật xong snapshot đổi NGAY (không cần restart)', async () => {
    expect(getMaxPoolSize()).toBe(3);

    await updateEnglishConfig('question_pool.maxPerBucket', 10);

    expect(getMaxPoolSize()).toBe(10);
    expect(getEnglishConfigSnapshot().question_pool.maxPerBucket).toBe(10);
  });

  it('các giá trị dẫn xuất tính lại theo (ngưỡng refill)', async () => {
    expect(getRefillThreshold()).toBe(2); // ceil(3 * 0.5)

    await updateEnglishConfig('question_pool.maxPerBucket', 10);
    expect(getRefillThreshold()).toBe(5); // ceil(10 * 0.5)

    await updateEnglishConfig('question_pool.refillThresholdRatio', 0.9);
    expect(getRefillThreshold()).toBe(9);
  });

  it('recordKey lạ -> BusinessLogicException', async () => {
    expect(updateEnglishConfig('khong.ton.tai', 1)).rejects.toThrow(BusinessLogicException);
  });

  it('sai kiểu -> BusinessLogicException, DB không đổi', async () => {
    expect(updateEnglishConfig('question_pool.maxPerBucket', 'ba')).rejects.toThrow(BusinessLogicException);
    expect(getMaxPoolSize()).toBe(3);
  });

  it('ngoài khoảng cho phép -> BusinessLogicException', async () => {
    expect(updateEnglishConfig('question_pool.maxPerBucket', -1)).rejects.toThrow(BusinessLogicException);
  });

  it('reset về default', async () => {
    await updateEnglishConfig('question_pool.maxPerBucket', 10);
    const row = await resetEnglishConfigToDefault('question_pool.maxPerBucket');

    expect(row.value).toBe(3);
    expect(getMaxPoolSize()).toBe(3);
  });
});

describe('updateEnglishConfigBulk — lý do bulk tồn tại', () => {
  it('sửa lần lượt từng record thì ràng buộc chéo chặn giữa chừng', async () => {
    // default: min=1, default=3, max=20. Muốn min=5 phải nâng default trước.
    expect(updateEnglishConfig('question_pool.manualFillMinCount', 5)).rejects.toThrow(BusinessLogicException);
  });

  it('bulk áp hết rồi mới validate MỘT lần -> cùng thay đổi đó thành công', async () => {
    await updateEnglishConfigBulk([
      { recordKey: 'question_pool.manualFillMinCount', value: 5 },
      { recordKey: 'question_pool.manualFillDefaultCount', value: 6 }
    ]);

    const cfg = getEnglishConfigSnapshot().question_pool;
    expect(cfg.manualFillMinCount).toBe(5);
    expect(cfg.manualFillDefaultCount).toBe(6);
  });

  it('bulk mà trạng thái CUỐI vẫn sai -> reject toàn bộ, không ghi một nửa', async () => {
    expect(
      updateEnglishConfigBulk([
        { recordKey: 'question_pool.manualFillMinCount', value: 9 },
        { recordKey: 'question_pool.manualFillDefaultCount', value: 6 }
      ])
    ).rejects.toThrow(BusinessLogicException);

    const cfg = getEnglishConfigSnapshot().question_pool;
    expect(cfg.manualFillMinCount).toBe(1);
    expect(cfg.manualFillDefaultCount).toBe(3);
  });

  it('danh sách rỗng -> BusinessLogicException', async () => {
    expect(updateEnglishConfigBulk([])).rejects.toThrow(BusinessLogicException);
  });

  it('recordKey trùng trong cùng một bulk -> BusinessLogicException', async () => {
    expect(
      updateEnglishConfigBulk([
        { recordKey: 'question_pool.maxPerBucket', value: 4 },
        { recordKey: 'question_pool.maxPerBucket', value: 5 }
      ])
    ).rejects.toThrow(BusinessLogicException);
  });

  it('một recordKey lạ làm hỏng cả bulk', async () => {
    expect(
      updateEnglishConfigBulk([
        { recordKey: 'question_pool.maxPerBucket', value: 4 },
        { recordKey: 'khong.ton.tai', value: 1 }
      ])
    ).rejects.toThrow(BusinessLogicException);

    expect(getMaxPoolSize()).toBe(3);
  });
});

describe('change hook', () => {
  it('hook chạy đúng recordKey được đăng ký', async () => {
    const calls: unknown[] = [];
    onEnglishConfigChanged('question_pool.maxPerBucket', (value) => {
      calls.push(value);
    });

    await updateEnglishConfig('question_pool.maxPerBucket', 7);
    await updateEnglishConfig('question_pool.perBucketGenerationCap', 4);

    expect(calls).toEqual([7]);
  });

  it('hook throw KHÔNG làm hỏng request (BullMQ lỗi không được chặn admin đổi config)', async () => {
    onEnglishConfigChanged('question_pool.perBucketGenerationCap', () => {
      throw new Error('scheduler reconcile hỏng');
    });

    await updateEnglishConfig('question_pool.perBucketGenerationCap', 4);

    expect(getEnglishConfigSnapshot().question_pool.perBucketGenerationCap).toBe(4);
  });
});

describe('chịu lỗi khi DB có giá trị hỏng', () => {
  it('giá trị hỏng rơi về default thay vì làm sập app lúc load', async () => {
    const db = (await import('@/configs/orm.config')).default;
    const { sql } = await import('drizzle-orm');

    // Nhét giá trị vô lý thẳng vào DB, mô phỏng dữ liệu cũ / sửa tay.
    await db.execute(
      sql`UPDATE english_config_records SET "valueNumber" = -99 WHERE "recordKey" = 'question_pool.maxPerBucket'`
    );

    const snapshot = await refreshEnglishConfig();

    expect(snapshot.question_pool.maxPerBucket).toBe(3); // default
  });
});

describe('mọi record đều nhận lại chính giá trị mặc định của nó', () => {
  it('ghi lại default cho từng record không gây lỗi validate', async () => {
    const rows = await getAllEnglishConfigRows();
    for (const row of rows) {
      const updated = await updateEnglishConfig(row.recordKey, row.defaultValue);
      expect(updated.value).toEqual(row.defaultValue);
    }
  });
});
