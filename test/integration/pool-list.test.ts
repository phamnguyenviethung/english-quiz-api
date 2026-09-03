import { beforeEach, describe, expect, it } from 'bun:test';
import questionPoolService, { escapeLikePattern } from '@/core/services/english/questionPool.service';
import { resetDb } from '../helpers/db.helper';
import { createTopic, seedPoolQuestion, seedPoolQuestions } from '../helpers/seed.helper';

let topicId: number;
let otherTopicId: number;

beforeEach(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
  otherTopicId = (await createTopic('travel')).id;
});

describe('listQuestions — ưu tiên giữa các filter chồng nhau', () => {
  it('withoutTopic THẮNG topicId (bucket không topic là bucket riêng, không phải tập con)', async () => {
    await seedPoolQuestion({ topicId });
    const noTopicId = await seedPoolQuestion({ topicId: null });

    const page = await questionPoolService.listQuestions({ topicId, withoutTopic: true });

    expect(page.items.map((i) => i.id)).toEqual([noTopicId]);
  });

  it('sourceQuestionId THẮNG onlySiblings', async () => {
    const sourceA = await seedPoolQuestion({ topicId });
    const sourceB = await seedPoolQuestion({ topicId });
    const siblingOfA = await seedPoolQuestion({ topicId, sourceQuestionId: sourceA });
    await seedPoolQuestion({ topicId, sourceQuestionId: sourceB });

    const page = await questionPoolService.listQuestions({ sourceQuestionId: sourceA, onlySiblings: true });

    expect(page.items.map((i) => i.id)).toEqual([siblingOfA]);
  });

  it('onlySiblings chỉ lấy câu có sourceQuestionId', async () => {
    const source = await seedPoolQuestion({ topicId });
    const sibling = await seedPoolQuestion({ topicId, sourceQuestionId: source });

    const page = await questionPoolService.listQuestions({ onlySiblings: true });

    expect(page.items.map((i) => i.id)).toEqual([sibling]);
  });
});

describe('listQuestions — tìm kiếm `q` phải escape ký tự LIKE', () => {
  it('escapeLikePattern thoát %, _ và backslash', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('q = "%" KHÔNG khớp toàn bảng (nếu không escape thì % là wildcard SQL)', async () => {
    await seedPoolQuestions(3, { topicId });

    const page = await questionPoolService.listQuestions({ q: '%' });

    expect(page.total).toBe(0);
  });

  it('q = "_" cũng không thành wildcard một ký tự', async () => {
    await seedPoolQuestions(3, { topicId });
    expect((await questionPoolService.listQuestions({ q: '_' })).total).toBe(0);
  });

  it('tìm theo nội dung questionData', async () => {
    await seedPoolQuestion({ topicId, dataOverrides: { word: 'serendipity' } });
    await seedPoolQuestion({ topicId, dataOverrides: { word: 'ordinary' } });

    const page = await questionPoolService.listQuestions({ q: 'serendipity' });

    expect(page.total).toBe(1);
  });

  it('q toàn số khớp CẢ id lẫn nội dung', async () => {
    const id = await seedPoolQuestion({ topicId, dataOverrides: { word: 'alpha' } });
    await seedPoolQuestion({ topicId, dataOverrides: { word: `số ${id}` } });

    const page = await questionPoolService.listQuestions({ q: String(id) });

    expect(page.total).toBe(2);
  });

  it('tìm theo tên model', async () => {
    await seedPoolQuestion({ topicId, model: 'google/gemini-flash' });
    await seedPoolQuestion({ topicId, model: 'openai/gpt-4o-mini' });

    expect((await questionPoolService.listQuestions({ q: 'gemini' })).total).toBe(1);
  });
});

describe('listQuestions — phân trang', () => {
  it('pageSize bị kẹp trong [1, 100]', async () => {
    await seedPoolQuestions(3, { topicId });

    expect((await questionPoolService.listQuestions({ pageSize: 0 })).pageSize).toBe(1);
    expect((await questionPoolService.listQuestions({ pageSize: 9999 })).pageSize).toBe(100);
  });

  it('page < 1 được nâng về 1', async () => {
    await seedPoolQuestions(2, { topicId });
    expect((await questionPoolService.listQuestions({ page: 0 })).page).toBe(1);
  });

  it('không sót/không trùng row khi duyệt hết các trang', async () => {
    const ids = await seedPoolQuestions(7, { topicId });

    const seen: number[] = [];
    for (let page = 1; page <= 4; page += 1) {
      const result = await questionPoolService.listQuestions({ page, pageSize: 2, sort: 'id_asc' });
      seen.push(...result.items.map((i) => i.id));
    }

    expect(seen.sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });

  it('createdAt trùng nhau vẫn phân trang ổn định nhờ tie-break theo id', async () => {
    const sameMoment = new Date('2026-01-01T00:00:00Z');
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(await seedPoolQuestion({ topicId, createdAt: sameMoment }));
    }

    const seen: number[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await questionPoolService.listQuestions({ page, pageSize: 2, sort: 'created_desc' });
      seen.push(...result.items.map((i) => i.id));
    }

    expect(new Set(seen).size).toBe(6);
    expect(seen.sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
  });

  it('totalPages tối thiểu là 1 kể cả khi rỗng', async () => {
    const page = await questionPoolService.listQuestions({});
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
  });
});

describe('listQuestions — sắp xếp', () => {
  it('token_desc sắp theo tổng tokenIn + tokenOut', async () => {
    const small = await seedPoolQuestion({ topicId, tokenIn: 1, tokenOut: 1 });
    const big = await seedPoolQuestion({ topicId, tokenIn: 500, tokenOut: 500 });

    const page = await questionPoolService.listQuestions({ sort: 'token_desc' });

    expect(page.items[0]?.id).toBe(big);
    expect(page.items[1]?.id).toBe(small);
  });

  it('sort không hợp lệ rơi về id_asc thay vì lỗi', async () => {
    const ids = await seedPoolQuestions(3, { topicId });
    const page = await questionPoolService.listQuestions({ sort: 'khong-ton-tai' as never });
    expect(page.items.map((i) => i.id)).toEqual(ids);
  });
});

describe('listQuestions — lọc theo bucket', () => {
  it('lọc đồng thời engLevel + quizType + topicId', async () => {
    const target = await seedPoolQuestion({ engLevel: 'B1', quizType: 'idiom', topicId, optionCount: 5 });
    await seedPoolQuestion({ engLevel: 'A1', quizType: 'idiom', topicId });
    await seedPoolQuestion({ engLevel: 'B1', quizType: 'vocab', topicId, optionCount: 5 });
    await seedPoolQuestion({ engLevel: 'B1', quizType: 'idiom', topicId: otherTopicId, optionCount: 5 });

    const page = await questionPoolService.listQuestions({ engLevel: 'B1', quizType: 'idiom', topicId });

    expect(page.items.map((i) => i.id)).toEqual([target]);
  });

  it('lọc theo optionCount', async () => {
    await seedPoolQuestion({ engLevel: 'A1', optionCount: 4, topicId });
    const five = await seedPoolQuestion({ engLevel: 'B1', optionCount: 5, topicId });

    const page = await questionPoolService.listQuestions({ optionCount: 5 });
    expect(page.items.map((i) => i.id)).toEqual([five]);
  });

  it('trả kèm topicName lấy từ bảng topic', async () => {
    await seedPoolQuestion({ topicId });
    const page = await questionPoolService.listQuestions({ topicId });
    expect(page.items[0]?.topicName).toBe('daily-life');
  });
});

describe('listPoolModels', () => {
  it('gom nhóm theo model, sắp giảm dần theo số lượng', async () => {
    await seedPoolQuestions(3, { topicId, model: 'model-a' });
    await seedPoolQuestion({ topicId, model: 'model-b' });

    const stats = await questionPoolService.listPoolModels();

    expect(stats).toEqual([
      { model: 'model-a', count: 3 },
      { model: 'model-b', count: 1 }
    ]);
  });
});
