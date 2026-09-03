import { describe, expect, it } from 'bun:test';
import { runWithConcurrency } from '@/utils/concurrency';

/**
 * Đây là bộ điều phối của MỌI đường manual refill (pool, sibling, reading, reading question).
 * Hai tính chất sống còn: (1) không dừng khi 1 bucket lỗi, (2) kết quả giữ đúng thứ tự input —
 * caller map ngược `results[i]` về `plan.planned[i]` để log bucket nào hỏng.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runWithConcurrency', () => {
  it('giữ đúng thứ tự input dù task xong lệch nhau', async () => {
    const tasks = [
      async () => {
        await delay(30);
        return 'chậm';
      },
      async () => 'nhanh',
      async () => {
        await delay(15);
        return 'vừa';
      }
    ];

    const results = await runWithConcurrency(tasks, 3);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(['chậm', 'nhanh', 'vừa']);
  });

  it('một task lỗi không làm dừng các task còn lại', async () => {
    const done: number[] = [];
    const tasks = [
      async () => {
        done.push(0);
        return 0;
      },
      async () => {
        throw new Error('bucket hỏng');
      },
      async () => {
        done.push(2);
        return 2;
      }
    ];

    const results = await runWithConcurrency(tasks, 2);

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]?.status).toBe('fulfilled');
    expect(done).toEqual([0, 2]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
  });

  it('không bao giờ chạy quá `limit` task cùng lúc', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await delay(10);
      running -= 1;
      return true;
    });

    await runWithConcurrency(tasks, 3);
    expect(peak).toBe(3);
  });

  it('chạy hết tất cả task kể cả khi nhiều hơn limit', async () => {
    const seen: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      seen.push(i);
      return i;
    });

    const results = await runWithConcurrency(tasks, 3);
    expect(results).toHaveLength(10);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('limit lớn hơn số task vẫn chạy bình thường', async () => {
    const results = await runWithConcurrency([async () => 1], 100);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('fulfilled');
  });

  it('mảng task rỗng trả về mảng rỗng, không treo', async () => {
    expect(await runWithConcurrency([], 5)).toEqual([]);
  });
});
