import { beforeEach, describe, expect, it } from 'bun:test';
import reviewService, { POOL_REVIEW_BATCH_MAX } from '@/core/services/english/questionPoolReview.service';
import questionPoolService from '@/core/services/english/questionPool.service';
import { BusinessLogicException, NotFoundException } from '@/core/exceptions';
import { countRows, resetDb } from '../helpers/db.helper';
import { mockLLM } from '../helpers/llm.helper';
import { createTopic, seedPoolQuestion } from '../helpers/seed.helper';
import { vocabQuestion } from '../fixtures/pool-question.fixture';
import { reviewResult, revisedReviewResult } from '../fixtures/review.fixture';

let topicId: number;
const ADMIN_ID = 'admin-user-id';

beforeEach(async () => {
  await resetDb();
  mockLLM.reset();
  topicId = (await createTopic('daily-life')).id;
});

/** enqueueReviews chạy fire-and-forget; đợi tới khi có đủ số row review. */
async function waitForReviews(count: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countRows('english_question_pool_reviews')) >= count) return;
    await Bun.sleep(20);
  }
  throw new Error(`Hết thời gian chờ ${count} review`);
}

async function enqueueOne(poolId: number) {
  const result = await reviewService.enqueueReviews([poolId], { requestedBy: ADMIN_ID });
  await waitForReviews(1);
  return result;
}

async function firstReview() {
  const page = await reviewService.listReviews({});
  return reviewService.getReviewById(page.items[0]!.id);
}

describe('enqueueReviews — nhận việc', () => {
  it('danh sách rỗng / toàn id rác -> BusinessLogicException', async () => {
    expect(reviewService.enqueueReviews([], { requestedBy: ADMIN_ID })).rejects.toThrow(BusinessLogicException);
    expect(reviewService.enqueueReviews([0, -1], { requestedBy: ADMIN_ID })).rejects.toThrow(BusinessLogicException);
  });

  it(`vượt ${POOL_REVIEW_BATCH_MAX} câu mỗi lần -> BusinessLogicException`, async () => {
    const ids = Array.from({ length: POOL_REVIEW_BATCH_MAX + 1 }, (_, i) => i + 1);
    expect(reviewService.enqueueReviews(ids, { requestedBy: ADMIN_ID })).rejects.toThrow(BusinessLogicException);
  });

  it('khử trùng lặp id trước khi chạy', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult());

    const result = await reviewService.enqueueReviews([id, id, id], { requestedBy: ADMIN_ID });
    await waitForReviews(1);

    expect(result.accepted).toBe(1);
    expect(await countRows('english_question_pool_reviews')).toBe(1);
  });

  it('id đã có review pending bị bỏ qua ở lần gọi sau', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult());
    await enqueueOne(id);

    const second = await reviewService.enqueueReviews([id], { requestedBy: ADMIN_ID });

    expect(second).toEqual({ accepted: 0, skipped: 1 });
  });

  it('pool id không tồn tại -> bỏ qua lặng lẽ, không ghi row', async () => {
    mockLLM.always(reviewResult());
    const result = await reviewService.enqueueReviews([999999], { requestedBy: ADMIN_ID });
    await Bun.sleep(100);

    expect(result.accepted).toBe(1);
    expect(await countRows('english_question_pool_reviews')).toBe(0);
  });
});

describe('reviewOne — ghi kết quả', () => {
  it('ghi đủ verdict/score/checklist/issues + snapshot bucket', async () => {
    const id = await seedPoolQuestion({ engLevel: 'A1', quizType: 'vocab', topicId });
    mockLLM.always(revisedReviewResult());

    await enqueueOne(id);
    const review = await firstReview();

    expect(review?.status).toBe('pending');
    expect(review?.verdict).toBe('revised');
    expect(review?.score).toBe(65);
    expect(review?.quizType).toBe('vocab');
    expect(review?.engLevel).toBe('A1');
    expect(review?.topicId).toBe(topicId);
    expect(review?.issues).toHaveLength(1);
  });

  it('formatValid do SERVER tính, không lấy từ AI', async () => {
    const id = await seedPoolQuestion({ topicId });
    // revisedData thiếu field bắt buộc -> parse hỏng -> formatValid phải là false.
    const broken = { ...vocabQuestion() };
    delete (broken as Record<string, unknown>).explanation;
    mockLLM.always(reviewResult({ revisedData: broken }));

    await enqueueOne(id);
    const review = await firstReview();

    expect(review?.checklist?.formatValid).toBe(false);
  });

  it('revisedData hợp lệ -> formatValid true', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult());

    await enqueueOne(id);

    expect((await firstReview())?.checklist?.formatValid).toBe(true);
  });

  it('changedFields = diff top-level giữa original và revised', async () => {
    const id = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Bản gốc.' } });
    mockLLM.always(
      reviewResult({
        verdict: 'revised',
        revisedData: vocabQuestion({ overrides: { explanation: 'Đã viết lại.' } })
      })
    );

    await enqueueOne(id);

    expect((await firstReview())?.changedFields).toEqual(['explanation']);
  });

  it('verdict pass + revisedData y hệt -> changedFields rỗng', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult({ revisedData: vocabQuestion() }));

    await enqueueOne(id);

    expect((await firstReview())?.changedFields).toEqual([]);
  });

  it('summary kèm kết quả AI tự giải (bằng chứng model thật sự làm bài)', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult({ summary: 'Ổn.' }));

    await enqueueOne(id);

    expect((await firstReview())?.summary).toContain('AI tự giải: A (high)');
  });

  it('LLM lỗi -> row status=failed, KHÔNG throw ra ngoài', async () => {
    const id = await seedPoolQuestion({ topicId });
    mockLLM.fail(new Error('OpenRouter timeout'));

    await enqueueOne(id);
    const review = await firstReview();

    expect(review?.status).toBe('failed');
    expect(review?.verdict).toBeNull();
    expect(review?.errorMessage).toContain('OpenRouter timeout');
  });

  it('questionData hỏng -> row failed, không gọi LLM', async () => {
    const id = await seedPoolQuestion({ topicId });
    const db = (await import('@/configs/orm.config')).default;
    const { englishQuestionPool } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    await db.update(englishQuestionPool).set({ questionData: 'hong' }).where(eq(englishQuestionPool.id, id));

    await enqueueOne(id);

    expect((await firstReview())?.status).toBe('failed');
    expect(mockLLM.callCount).toBe(0);
  });
});

describe('máy trạng thái duyệt', () => {
  async function seedPendingReview(): Promise<{ poolId: number; reviewId: number }> {
    const poolId = await seedPoolQuestion({ topicId, dataOverrides: { explanation: 'Bản gốc.' } });
    mockLLM.always(
      reviewResult({
        verdict: 'revised',
        revisedData: vocabQuestion({ overrides: { explanation: 'Bản AI sửa.' } })
      })
    );
    await enqueueOne(poolId);
    const page = await reviewService.listReviews({});
    return { poolId, reviewId: page.items[0]!.id };
  }

  it('approve ghi đè câu trong pool và set updatedAt', async () => {
    const { poolId, reviewId } = await seedPendingReview();
    const before = await questionPoolService.getPoolQuestionById(poolId);
    expect(JSON.parse(before!.questionData).explanation).toBe('Bản gốc.');

    await reviewService.approveReview(reviewId, { userId: ADMIN_ID });

    const after = await questionPoolService.getPoolQuestionById(poolId);
    expect(JSON.parse(after!.questionData).explanation).toBe('Bản AI sửa.');

    const review = await reviewService.getReviewById(reviewId);
    expect(review?.status).toBe('approved');
    expect(review?.resolvedByUserId).toBe(ADMIN_ID);
    expect(review?.resolvedAt).not.toBeNull();
  });

  it('approve kèm data admin tự sửa -> bản admin THẮNG bản AI', async () => {
    const { poolId, reviewId } = await seedPendingReview();

    await reviewService.approveReview(reviewId, {
      userId: ADMIN_ID,
      data: vocabQuestion({ overrides: { explanation: 'Bản admin tự viết.' } })
    });

    const after = await questionPoolService.getPoolQuestionById(poolId);
    expect(JSON.parse(after!.questionData).explanation).toBe('Bản admin tự viết.');
  });

  it('approve với data sai schema -> lỗi, pool không đổi', async () => {
    const { poolId, reviewId } = await seedPendingReview();

    expect(reviewService.approveReview(reviewId, { userId: ADMIN_ID, data: { chi: 'rác' } })).rejects.toThrow();

    const after = await questionPoolService.getPoolQuestionById(poolId);
    expect(JSON.parse(after!.questionData).explanation).toBe('Bản gốc.');
  });

  it('reject KHÔNG đụng vào pool', async () => {
    const { poolId, reviewId } = await seedPendingReview();

    await reviewService.rejectReview(reviewId, { userId: ADMIN_ID, note: 'không ổn' });

    const after = await questionPoolService.getPoolQuestionById(poolId);
    expect(JSON.parse(after!.questionData).explanation).toBe('Bản gốc.');
    expect((await reviewService.getReviewById(reviewId))?.status).toBe('rejected');
  });

  it('chỉ review pending mới approve/reject được', async () => {
    const { reviewId } = await seedPendingReview();
    await reviewService.approveReview(reviewId, { userId: ADMIN_ID });

    expect(reviewService.approveReview(reviewId, { userId: ADMIN_ID })).rejects.toThrow(BusinessLogicException);
    expect(reviewService.rejectReview(reviewId, { userId: ADMIN_ID })).rejects.toThrow(BusinessLogicException);
  });

  it('approve review không tồn tại -> NotFoundException', async () => {
    expect(reviewService.approveReview(999999, { userId: ADMIN_ID })).rejects.toThrow(NotFoundException);
  });

  it('xoá review', async () => {
    const { reviewId } = await seedPendingReview();
    await reviewService.deleteReview(reviewId);
    expect(await reviewService.getReviewById(reviewId)).toBeNull();
  });
});

describe('review bị cascade khi xoá câu pool', () => {
  it('xoá pool question -> review của nó biến mất', async () => {
    const poolId = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult());
    await enqueueOne(poolId);
    expect(await countRows('english_question_pool_reviews')).toBe(1);

    const db = (await import('@/configs/orm.config')).default;
    const { englishQuestionPool } = await import('@/core/db/schema/main');
    const { eq } = await import('drizzle-orm');
    await db.delete(englishQuestionPool).where(eq(englishQuestionPool.id, poolId));

    expect(await countRows('english_question_pool_reviews')).toBe(0);
  });
});

describe('listReviews', () => {
  it('lọc theo status và verdict', async () => {
    const a = await seedPoolQuestion({ topicId });
    const b = await seedPoolQuestion({ topicId });
    mockLLM.enqueue(reviewResult({ verdict: 'pass' }));
    mockLLM.fail(new Error('hỏng'));
    await reviewService.enqueueReviews([a, b], { requestedBy: ADMIN_ID });
    await waitForReviews(2);

    expect((await reviewService.listReviews({ status: 'pending' })).total).toBe(1);
    expect((await reviewService.listReviews({ status: 'failed' })).total).toBe(1);
    expect((await reviewService.listReviews({ verdict: 'pass' })).total).toBe(1);
  });

  it('lọc theo poolQuestionRefId', async () => {
    const a = await seedPoolQuestion({ topicId });
    const b = await seedPoolQuestion({ topicId });
    mockLLM.always(reviewResult());
    await reviewService.enqueueReviews([a, b], { requestedBy: ADMIN_ID });
    await waitForReviews(2);

    const page = await reviewService.listReviews({ poolQuestionRefId: a });
    expect(page.total).toBe(1);
    expect(page.items[0]?.poolQuestionRefId).toBe(a);
  });
});
