import { describe, expect, it } from 'bun:test';
import { buildRefillPlan, isBucketDeficient } from '@/core/services/english/poolRefill.service';
import {
  getMaxPoolSize,
  getPerBucketGenerationCap,
  getRefillThreshold
} from '@/core/services/english/questionPool.service';

/**
 * buildRefillPlan là hàm thuần được dùng lại cho CẢ BA pipeline (question pool, reading
 * passage, reading question) — sai ở đây là sai đồng loạt, và triệu chứng chỉ hiện ra dưới
 * dạng "đốt token" hoặc "bucket không bao giờ đầy", rất khó truy.
 */

function candidate(deficiency: number, label = 'b') {
  return { deficiency, label };
}

describe('buildRefillPlan — trần theo từng bucket', () => {
  it('mỗi bucket chỉ đặt sinh đúng phần còn thiếu', () => {
    const plan = buildRefillPlan([candidate(2), candidate(1)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5
    });

    expect(plan.planned.map((item) => item.count)).toEqual([2, 1]);
    expect(plan.cappedByBudget).toBe(false);
  });

  it('không vượt perBucketCap dù bucket thiếu nhiều hơn', () => {
    const plan = buildRefillPlan([candidate(100)], { maxQuestionsPerRun: null, perBucketCap: 5 });
    expect(plan.planned[0]?.count).toBe(5);
  });

  it('bucket đã đủ (deficiency <= 0) bị loại khỏi plan, không sinh câu thừa', () => {
    const plan = buildRefillPlan([candidate(0), candidate(-3), candidate(2)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5
    });

    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]?.count).toBe(2);
  });

  it('totalBuckets đếm bucket ĐẦU VÀO, không phải bucket được plan', () => {
    // Con số này hiển thị cho admin dưới dạng "x/y bucket" — đếm nhầm sang planned thì
    // dashboard luôn báo 100%.
    const plan = buildRefillPlan([candidate(0), candidate(0), candidate(1)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5
    });

    expect(plan.totalBuckets).toBe(3);
    expect(plan.planned).toHaveLength(1);
  });
});

describe('buildRefillPlan — budget của cả lần chạy', () => {
  it('maxQuestionsPerRun = null nghĩa là không giới hạn (đường admin manual)', () => {
    const plan = buildRefillPlan([candidate(5), candidate(5), candidate(5)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5
    });

    expect(plan.planned).toHaveLength(3);
    expect(plan.cappedByBudget).toBe(false);
  });

  it('cắt MỘT PHẦN ở bucket chạm trần thay vì bỏ cả bucket', () => {
    // 4 + 4 = 8 > 6, bucket thứ hai phải được nhận 2 câu còn lại chứ không bị loại —
    // bỏ cả bucket là lãng phí phần budget còn thừa.
    const plan = buildRefillPlan([candidate(4), candidate(4)], {
      maxQuestionsPerRun: 6,
      perBucketCap: 5
    });

    expect(plan.planned.map((item) => item.count)).toEqual([4, 2]);
    expect(plan.cappedByBudget).toBe(true);
  });

  it('dừng hẳn khi budget cạn, các bucket sau không vào plan', () => {
    const plan = buildRefillPlan([candidate(3), candidate(3), candidate(3)], {
      maxQuestionsPerRun: 3,
      perBucketCap: 5
    });

    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0]?.count).toBe(3);
    expect(plan.cappedByBudget).toBe(true);
    expect(plan.totalBuckets).toBe(3);
  });

  it('budget = 0 thì không plan gì nhưng vẫn báo bị cap', () => {
    const plan = buildRefillPlan([candidate(3)], { maxQuestionsPerRun: 0, perBucketCap: 5 });
    expect(plan.planned).toHaveLength(0);
    expect(plan.cappedByBudget).toBe(true);
  });

  it('tổng số câu được plan không bao giờ vượt budget', () => {
    const plan = buildRefillPlan(
      Array.from({ length: 20 }, () => candidate(3)),
      { maxQuestionsPerRun: 10, perBucketCap: 5 }
    );

    const total = plan.planned.reduce((sum, item) => sum + item.count, 0);
    expect(total).toBe(10);
  });
});

describe('buildRefillPlan — forceCount (admin ép số lượng)', () => {
  it('forceCount ghi đè deficiency, kể cả bucket đang đầy', () => {
    const plan = buildRefillPlan([candidate(0), candidate(-5)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5,
      forceCount: 3
    });

    expect(plan.planned.map((item) => item.count)).toEqual([3, 3]);
  });

  it('forceCount vẫn bị perBucketCap chặn', () => {
    const plan = buildRefillPlan([candidate(0)], {
      maxQuestionsPerRun: null,
      perBucketCap: 2,
      forceCount: 10
    });

    expect(plan.planned[0]?.count).toBe(2);
  });

  it('forceCount = 0 thì không plan bucket nào', () => {
    const plan = buildRefillPlan([candidate(5)], {
      maxQuestionsPerRun: null,
      perBucketCap: 5,
      forceCount: 0
    });

    expect(plan.planned).toHaveLength(0);
  });

  it('giữ nguyên các field khác của candidate khi gắn count', () => {
    const plan = buildRefillPlan([{ deficiency: 2, engLevel: 'A1', topicId: null }], {
      maxQuestionsPerRun: null,
      perBucketCap: 5
    });

    expect(plan.planned[0]).toMatchObject({ deficiency: 2, engLevel: 'A1', topicId: null, count: 2 });
  });
});

describe('ngưỡng thiếu hụt của bucket', () => {
  it("thresholdCheck 'ratio' dùng ngưỡng refill, 'target' dùng maxPerBucket", () => {
    // Mặc định: maxPerBucket = 3, refillThresholdRatio = 0.5 -> ngưỡng ratio = ceil(1.5) = 2.
    expect(getMaxPoolSize()).toBe(3);
    expect(getRefillThreshold()).toBe(2);

    // count = 2: đủ so với ngưỡng ratio (backstop không kích hoạt) nhưng vẫn thiếu so với target.
    expect(isBucketDeficient({ currentCount: 2 }, 'ratio')).toBe(false);
    expect(isBucketDeficient({ currentCount: 2 }, 'target')).toBe(true);

    expect(isBucketDeficient({ currentCount: 1 }, 'ratio')).toBe(true);
    expect(isBucketDeficient({ currentCount: 3 }, 'target')).toBe(false);
  });

  it('không truyền thresholdCheck thì mặc định là target', () => {
    expect(isBucketDeficient({ currentCount: 2 })).toBe(isBucketDeficient({ currentCount: 2 }, 'target'));
  });

  it('perBucketGenerationCap mặc định là 5', () => {
    expect(getPerBucketGenerationCap()).toBe(5);
  });
});
