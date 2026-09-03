import { beforeEach, describe, expect, it } from 'bun:test';
import {
  bucketKeyOf,
  buildManualRefillPlan,
  scanBuckets,
  type RefillBucketCandidate
} from '@/core/services/english/poolRefill.service';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';
import { resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { createTopic, seedCronBucketHistory, seedPoolQuestions } from '../helpers/seed.helper';

let topicId: number;

/** Thu hẹp về 1 quizType để số bucket đủ nhỏ mà suy luận bằng tay được. */
async function onlyQuizType(quizType: string): Promise<void> {
  const items = getEnglishConfigSnapshot().quiz_distribution.map((item) => ({
    ...item,
    enabled: item.quizType === quizType,
    weight: item.quizType === quizType ? 10 : 0
  }));
  await setConfig({ 'quiz_distribution.items': items });
}

beforeEach(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
  await onlyQuizType('vocab');
});

describe('scanBuckets — không gian bucket', () => {
  it('sinh tích Descartes topic × engLevel × quizType đang bật', async () => {
    const candidates = await scanBuckets({ scope: 'all' });
    // 1 topic × 4 engLevel × 1 quizType
    expect(candidates).toHaveLength(4);
    expect(new Set(candidates.map((c) => c.engLevel))).toEqual(new Set(['A1', 'A2', 'B1', 'B2']));
  });

  it('quizType bị tắt không xuất hiện', async () => {
    const candidates = await scanBuckets({ scope: 'all' });
    expect(candidates.every((c) => c.quizType === 'vocab')).toBe(true);
  });

  it('optionCount = 4 cho A1/A2 và 5 cho B1/B2', async () => {
    const candidates = await scanBuckets({ scope: 'all' });
    for (const c of candidates) {
      expect(c.optionCount).toBe(c.engLevel === 'A1' || c.engLevel === 'A2' ? 4 : 5);
    }
  });

  it('deficiency = maxPerBucket - số câu hiện có', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });

    const candidates = await scanBuckets({ scope: 'all' });
    const a1 = candidates.find((c) => c.engLevel === 'A1')!;

    expect(a1.currentCount).toBe(2);
    expect(a1.deficiency).toBe(1); // maxPerBucket mặc định 3
  });

  it("scope 'deficient' loại bucket đã đầy", async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });

    const all = await scanBuckets({ scope: 'all' });
    const deficient = await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' });

    expect(all).toHaveLength(4);
    expect(deficient).toHaveLength(3);
    expect(deficient.some((c) => c.engLevel === 'A1')).toBe(false);
  });

  it("thresholdCheck 'ratio' rộng hơn 'target'", async () => {
    // 2 câu: đủ so với ngưỡng ratio (=2) nhưng vẫn thiếu so với target (=3).
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId });

    const byRatio = await scanBuckets({ scope: 'deficient', thresholdCheck: 'ratio' });
    const byTarget = await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' });

    expect(byRatio.some((c) => c.engLevel === 'A1')).toBe(false);
    expect(byTarget.some((c) => c.engLevel === 'A1')).toBe(true);
  });
});

describe('scanBuckets — filter', () => {
  it('lọc theo engLevels', async () => {
    const candidates = await scanBuckets({ scope: 'all', filter: { engLevels: ['A1', 'B2'] } });
    expect(new Set(candidates.map((c) => c.engLevel))).toEqual(new Set(['A1', 'B2']));
  });

  it('mảng filter rỗng = KHÔNG lọc chiều đó', async () => {
    const candidates = await scanBuckets({ scope: 'all', filter: { engLevels: [] } });
    expect(candidates).toHaveLength(4);
  });

  it('lọc theo topicIds', async () => {
    const other = await createTopic('travel');
    const candidates = await scanBuckets({ scope: 'all', filter: { topicIds: [other.id] } });
    expect(candidates.every((c) => c.topicId === other.id)).toBe(true);
  });

  it('bucketKeys chốt danh sách cụ thể, áp dụng SAU filter', async () => {
    const key = bucketKeyOf({ engLevel: 'B1', topicId, quizType: 'vocab' });
    const candidates = await scanBuckets({ scope: 'all', bucketKeys: [key] });

    expect(candidates).toHaveLength(1);
    expect(bucketKeyOf(candidates[0]!)).toBe(key);
  });

  it('bucketKeys giao với filter loại trừ nhau -> rỗng', async () => {
    const key = bucketKeyOf({ engLevel: 'B1', topicId, quizType: 'vocab' });
    const candidates = await scanBuckets({ scope: 'all', filter: { engLevels: ['A1'] }, bucketKeys: [key] });
    expect(candidates).toHaveLength(0);
  });
});

describe('scanBuckets — thứ tự chống đói', () => {
  function keys(candidates: RefillBucketCandidate[]): string[] {
    return candidates.map((c) => bucketKeyOf(c));
  }

  it('ưu tiên 1: bucket thiếu nhiều hơn đứng trước', async () => {
    await seedPoolQuestions(2, { engLevel: 'A1', quizType: 'vocab', topicId }); // thiếu 1
    await seedPoolQuestions(1, { engLevel: 'A2', quizType: 'vocab', topicId }); // thiếu 2
    // B1, B2 thiếu 3

    const candidates = await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' });

    expect(candidates[0]!.deficiency).toBe(3);
    expect(candidates.at(-1)!.engLevel).toBe('A1');
    expect(candidates.map((c) => c.deficiency)).toEqual([3, 3, 2, 1]);
  });

  it('ưu tiên 2: cùng deficiency thì bucket refill lâu nhất đứng trước', async () => {
    const a1 = bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' });
    const a2 = bucketKeyOf({ engLevel: 'A2', topicId, quizType: 'vocab' });

    await seedCronBucketHistory({ bucketKey: a1, finishedAt: new Date('2026-01-02T00:00:00Z') });
    await seedCronBucketHistory({ bucketKey: a2, finishedAt: new Date('2026-01-01T00:00:00Z') });

    const ordered = keys(await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' }));

    // B1/B2 chưa từng refill (null) nên đứng trước cả hai; giữa A1 và A2 thì A2 cũ hơn.
    expect(ordered.indexOf(a2)).toBeLessThan(ordered.indexOf(a1));
  });

  it('bucket CHƯA TỪNG refill (null) được ưu tiên trước bucket đã refill', async () => {
    const a1 = bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' });
    await seedCronBucketHistory({ bucketKey: a1, finishedAt: new Date('2026-01-01T00:00:00Z') });

    const ordered = keys(await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' }));

    expect(ordered.at(-1)).toBe(a1);
  });

  it('chỉ tính lần refill THÀNH CÔNG — bucket chỉ từng fail vẫn coi như chưa refill', async () => {
    const a1 = bucketKeyOf({ engLevel: 'A1', topicId, quizType: 'vocab' });
    const a2 = bucketKeyOf({ engLevel: 'A2', topicId, quizType: 'vocab' });

    await seedCronBucketHistory({ bucketKey: a1, finishedAt: new Date('2026-01-05T00:00:00Z'), status: 'failed' });
    await seedCronBucketHistory({ bucketKey: a2, finishedAt: new Date('2026-01-01T00:00:00Z'), status: 'success' });

    const ordered = keys(await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' }));

    expect(ordered.indexOf(a1)).toBeLessThan(ordered.indexOf(a2));
  });

  it('thứ tự xác định (không phụ thuộc may rủi) khi mọi thứ ngang nhau', async () => {
    const first = keys(await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' }));
    const second = keys(await scanBuckets({ scope: 'deficient', thresholdCheck: 'target' }));
    expect(first).toEqual(second);
  });
});

describe('buildManualRefillPlan — preview PHẢI bằng lúc chạy thật', () => {
  it("scope 'all': mọi bucket được plan đúng manualFillDefaultCount", async () => {
    const { matched, plan } = await buildManualRefillPlan({ scope: 'all' });
    const defaultCount = getEnglishConfigSnapshot().question_pool.manualFillDefaultCount;

    expect(matched).toHaveLength(4);
    expect(plan.planned).toHaveLength(4);
    expect(plan.planned.every((item) => item.count === defaultCount)).toBe(true);
  });

  it("scope 'all' vẫn plan cả bucket đang đầy (admin chủ động ép)", async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });

    const { plan } = await buildManualRefillPlan({ scope: 'all' });

    expect(plan.planned.some((item) => item.engLevel === 'A1')).toBe(true);
  });

  it("scope 'deficient' chỉ top-up phần còn thiếu", async () => {
    await seedPoolQuestions(3, { engLevel: 'A1', quizType: 'vocab', topicId });
    await seedPoolQuestions(1, { engLevel: 'A2', quizType: 'vocab', topicId });

    const { matched, plan } = await buildManualRefillPlan({ scope: 'deficient' });

    // matched giữ CẢ bucket bị bỏ qua, để preview nói được "đã đủ câu, bỏ qua".
    expect(matched).toHaveLength(4);
    expect(plan.planned).toHaveLength(3);
    expect(plan.planned.find((item) => item.engLevel === 'A2')?.count).toBe(2);
  });

  it('countPerBucket do admin truyền ghi đè mọi thứ, vẫn bị perBucketGenerationCap chặn', async () => {
    const { plan } = await buildManualRefillPlan({ scope: 'all', countPerBucket: 999 });
    expect(plan.planned.every((item) => item.count === 5)).toBe(true); // cap mặc định 5
  });

  it('manual KHÔNG bị giới hạn budget của scheduled run', async () => {
    await setConfig({ 'job_flags.poolRefillMaxQuestionsPerRun': 1 });

    const { plan } = await buildManualRefillPlan({ scope: 'all' });

    expect(plan.cappedByBudget).toBe(false);
    expect(plan.planned).toHaveLength(4);
  });

  it('filter thu hẹp cả matched lẫn planned', async () => {
    const { matched, plan } = await buildManualRefillPlan({ scope: 'all', filter: { engLevels: ['A1'] } });
    expect(matched).toHaveLength(1);
    expect(plan.planned).toHaveLength(1);
  });
});
