import { beforeEach, describe, expect, it } from 'bun:test';
import readingPassageService from '@/core/services/english/readingPassage.service';
import readingQuestionService from '@/core/services/english/readingQuestion.service';
import { NotFoundException } from '@/core/exceptions';
import { countRows, resetDb } from '../helpers/db.helper';
import { setConfig } from '../helpers/config.helper';
import { createTopic, seedPassage, seedReadingQuestion, seedReadyPassage } from '../helpers/seed.helper';

let topicId: number;
let otherTopicId: number;

beforeEach(async () => {
  await resetDb();
  topicId = (await createTopic('daily-life')).id;
  otherTopicId = (await createTopic('science')).id;
});

describe('popPassageWithQuestions — chỉ phục vụ bài ĐỦ câu hỏi', () => {
  it('bài đủ 3 câu active -> được trả kèm bộ câu hỏi', async () => {
    const id = await seedReadyPassage({ cefrLevel: 'A1', topicId });

    const result = await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId });

    expect(result?.passage.id).toBe(id);
    expect(result?.passage.title).toBeTruthy();
    expect(result?.questions).toHaveLength(3);
    for (const q of result!.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctAnswer).toBeGreaterThanOrEqual(0);
      expect(q.correctAnswer).toBeLessThan(q.options.length);
    }
  });

  it('bài THIẾU câu hỏi không bao giờ được phục vụ', async () => {
    const passageId = await seedPassage({ cefrLevel: 'A1', topicId });
    await seedReadingQuestion({ passageRefId: passageId, cefrLevel: 'A1', topicId });
    await seedReadingQuestion({ passageRefId: passageId, cefrLevel: 'A1', topicId });

    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });

  it('bài không có câu hỏi nào -> không phục vụ', async () => {
    await seedPassage({ cefrLevel: 'A1', topicId });
    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });

  it('deactivate 1 câu làm bài tụt xuống dưới ngưỡng -> ngừng phục vụ', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A1', topicId });
    const questions = await readingQuestionService.listQuestions({ passageId });

    await readingQuestionService.updateQuestion(questions.items[0]!.id, { isActive: false });

    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });

  it('passage isActive = false -> không phục vụ dù đủ câu', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId, isActive: false });
    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });

  it('type là filter CỨNG (daily khác academic)', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId, type: 'academic' });

    expect(
      await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId, type: 'daily' })
    ).toBeNull();
    expect(
      await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId, type: 'academic' })
    ).not.toBeNull();
  });

  it('excludeIds loại bài đã đọc', async () => {
    const a = await seedReadyPassage({ cefrLevel: 'A1', topicId });
    const b = await seedReadyPassage({ cefrLevel: 'A1', topicId });

    const picked = await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId, excludeIds: [a] });

    expect(picked?.passage.id).toBe(b);
  });

  it('loại hết -> null', async () => {
    const a = await seedReadyPassage({ cefrLevel: 'A1', topicId });
    expect(
      await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId, excludeIds: [a] })
    ).toBeNull();
  });

  it('allowedTopicIds rỗng -> null NGAY (tenant chưa được cấp topic nào)', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId });

    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', allowedTopicIds: [] })).toBeNull();
  });

  it('allowedTopicIds giới hạn bài được phục vụ khi không chỉ định topicId', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId });
    const allowed = await seedReadyPassage({ cefrLevel: 'A1', topicId: otherTopicId });

    for (let i = 0; i < 5; i += 1) {
      const picked = await readingQuestionService.popPassageWithQuestions({
        cefrLevel: 'A1',
        allowedTopicIds: [otherTopicId]
      });
      expect(picked?.passage.id).toBe(allowed);
    }
  });

  it('chỉ trả câu hỏi ACTIVE của bài đó', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A1', topicId, questionCount: 4 });
    const questions = await readingQuestionService.listQuestions({ passageId });
    await readingQuestionService.updateQuestion(questions.items[0]!.id, { isActive: false });

    const result = await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId });

    expect(result?.questions).toHaveLength(3);
  });

  it('ngưỡng đi theo config questionsPerPassage', async () => {
    await setConfig({ 'reading_question.questionsPerPassage': 5 });
    await seedReadyPassage({ cefrLevel: 'A1', topicId, questionCount: 3 });

    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });
});

describe('countReadyPassages', () => {
  it('chỉ đếm bài đủ câu hỏi', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId });
    const thin = await seedPassage({ cefrLevel: 'A1', topicId });
    await seedReadingQuestion({ passageRefId: thin, cefrLevel: 'A1', topicId });

    expect(await readingQuestionService.countReadyPassages({ cefrLevel: 'A1', topicId })).toBe(1);
  });

  it('tenant không có topic nào -> 0', async () => {
    await seedReadyPassage({ cefrLevel: 'A1', topicId });
    expect(await readingQuestionService.countReadyPassages({ cefrLevel: 'A1', allowedTopicIds: [] })).toBe(0);
  });
});

describe('updatePassage — sửa nội dung làm câu hỏi cũ hết hạn', () => {
  it('đổi paragraphs -> deactivate hết câu hỏi + reset questionGenAttempts + tính lại wordCount', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A1', topicId });
    await readingPassageService.incrementQuestionGenAttempts(passageId);

    const updated = await readingPassageService.updatePassage(passageId, {
      paragraphs: ['A totally new paragraph with exactly ten words inside it here.']
    });

    expect(updated.wordCount).toBe(11);

    // updatePassage không trả questionGenAttempts trong SELECT_COLUMNS -> đọc lại từ danh sách chờ.
    const candidates = await readingPassageService.listQuestionGenCandidates({ passageIds: [passageId] });
    expect(candidates[0]?.questionGenAttempts).toBe(0);

    const questions = await readingQuestionService.listQuestions({ passageId });
    expect(questions.items.every((q) => q.isActive === false)).toBe(true);

    // Hệ quả nghiệp vụ: bài không còn được phục vụ cho tới khi sinh lại câu hỏi.
    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).toBeNull();
  });

  it('chỉ đổi title thì KHÔNG đụng tới câu hỏi', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A1', topicId });

    await readingPassageService.updatePassage(passageId, { title: 'Tiêu đề mới' });

    const questions = await readingQuestionService.listQuestions({ passageId });
    expect(questions.items.every((q) => q.isActive === true)).toBe(true);
    expect(await readingQuestionService.popPassageWithQuestions({ cefrLevel: 'A1', topicId })).not.toBeNull();
  });

  it('passage không tồn tại -> NotFoundException', async () => {
    expect(readingPassageService.updatePassage(999999, { title: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('xoá passage kéo theo câu hỏi (cascade)', () => {
  it('deletePassage xoá luôn câu hỏi của nó', async () => {
    const passageId = await seedReadyPassage({ cefrLevel: 'A1', topicId });
    expect(await countRows('english_reading_questions')).toBe(3);

    await readingPassageService.deletePassage(passageId);

    expect(await countRows('english_reading_passages')).toBe(0);
    expect(await countRows('english_reading_questions')).toBe(0);
  });
});

describe('insertPassages — trần maxPerBucket', () => {
  function passageInput(overrides: Record<string, unknown> = {}) {
    return {
      title: `Bài ${Math.random().toString(36).slice(2, 8)}`,
      paragraphs: ['One paragraph here.', 'Another paragraph here.'],
      wordCount: 6,
      cefrLevel: 'A1' as const,
      topicId,
      topicName: 'daily-life',
      type: 'daily' as const,
      model: 'test/model',
      tokenIn: 10,
      tokenOut: 5,
      ...overrides
    };
  }

  it('bucket đầy -> bỏ qua phần thừa', async () => {
    for (let i = 0; i < 3; i += 1) await seedPassage({ cefrLevel: 'A1', topicId, type: 'daily' });

    const inserted = await readingPassageService.insertPassages([passageInput(), passageInput()]);

    expect(inserted).toBe(0);
    expect(await readingPassageService.getCount('A1', topicId, 'daily')).toBe(3);
  });

  it('daily và academic là hai bucket riêng', async () => {
    for (let i = 0; i < 3; i += 1) await seedPassage({ cefrLevel: 'A1', topicId, type: 'daily' });

    const inserted = await readingPassageService.insertPassages([passageInput({ type: 'academic' })]);

    expect(inserted).toBe(1);
  });

  it('chỉ đếm passage đang active khi tính bucket đầy', async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedPassage({ cefrLevel: 'A1', topicId, type: 'daily', isActive: false });
    }

    expect(await readingPassageService.insertPassages([passageInput()])).toBe(1);
  });
});

describe('getRecentTitles — chống lặp đề tài', () => {
  it('trả title gần nhất của đúng bucket đó', async () => {
    await seedPassage({ title: 'Bài cũ', cefrLevel: 'A1', topicId, type: 'daily' });
    await seedPassage({ title: 'Bài mới', cefrLevel: 'A1', topicId, type: 'daily' });
    await seedPassage({ title: 'Bài khác bucket', cefrLevel: 'B2', topicId, type: 'daily' });

    const titles = await readingPassageService.getRecentTitles('A1', topicId, 'daily', 10);

    expect(titles).toContain('Bài cũ');
    expect(titles).toContain('Bài mới');
    expect(titles).not.toContain('Bài khác bucket');
  });

  it('giới hạn đúng số lượng yêu cầu, lấy bài mới nhất', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedPassage({ title: `Bài ${i}`, cefrLevel: 'A1', topicId, type: 'daily' });
    }

    const titles = await readingPassageService.getRecentTitles('A1', topicId, 'daily', 2);

    expect(titles).toHaveLength(2);
    expect(titles).toContain('Bài 4');
  });
});

describe('questionGenAttempts — chốt chặn vòng lặp vô tận', () => {
  const MAX_ATTEMPTS = 3; // reading_question.maxGenerationAttempts mặc định

  it('passage vượt ngưỡng attempts bị loại khỏi danh sách chờ sinh câu', async () => {
    const ok = await seedPassage({ cefrLevel: 'A1', topicId, questionGenAttempts: 0 });
    await seedPassage({ cefrLevel: 'A1', topicId, questionGenAttempts: MAX_ATTEMPTS });

    const candidates = await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS });

    expect(candidates.map((c) => c.id)).toEqual([ok]);
  });

  it('increment tăng dần tới ngưỡng rồi biến mất khỏi danh sách chờ', async () => {
    const id = await seedPassage({ cefrLevel: 'A1', topicId });

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      expect(await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS })).toHaveLength(1);
      await readingPassageService.incrementQuestionGenAttempts(id);
    }

    expect(await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS })).toHaveLength(0);
  });

  it('reset đưa passage trở lại danh sách chờ', async () => {
    const id = await seedPassage({ cefrLevel: 'A1', topicId, questionGenAttempts: MAX_ATTEMPTS });
    expect(await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS })).toHaveLength(0);

    await readingPassageService.resetQuestionGenAttempts(id);

    expect(await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS })).toHaveLength(1);
  });

  it('passage isActive = false không nằm trong danh sách chờ', async () => {
    await seedPassage({ cefrLevel: 'A1', topicId, isActive: false });
    expect(await readingPassageService.listQuestionGenCandidates({ maxAttempts: MAX_ATTEMPTS })).toHaveLength(0);
  });

  it('lọc thêm theo cefrLevels / topicIds', async () => {
    const a1 = await seedPassage({ cefrLevel: 'A1', topicId });
    await seedPassage({ cefrLevel: 'B2', topicId });
    await seedPassage({ cefrLevel: 'A1', topicId: otherTopicId });

    const byLevel = await readingPassageService.listQuestionGenCandidates({ cefrLevels: ['A1'] });
    expect(byLevel).toHaveLength(2);

    const byBoth = await readingPassageService.listQuestionGenCandidates({
      cefrLevels: ['A1'],
      topicIds: [topicId]
    });
    expect(byBoth.map((c) => c.id)).toEqual([a1]);
  });
});

describe('updateQuestion — sửa options phải kiểm lại correctAnswer', () => {
  it('correctAnswer trỏ ra ngoài mảng options mới -> lỗi', async () => {
    const passageId = await seedPassage({ cefrLevel: 'A1', topicId });
    const qId = await seedReadingQuestion({ passageRefId: passageId, cefrLevel: 'A1', topicId });

    expect(readingQuestionService.updateQuestion(qId, { options: ['a', 'b'], correctAnswer: 5 })).rejects.toThrow();
  });

  it('sửa options + correctAnswer hợp lệ thì thành công', async () => {
    const passageId = await seedPassage({ cefrLevel: 'A1', topicId });
    const qId = await seedReadingQuestion({ passageRefId: passageId, cefrLevel: 'A1', topicId });

    const updated = await readingQuestionService.updateQuestion(qId, {
      options: ['w', 'x', 'y', 'z'],
      correctAnswer: 2
    });

    expect(updated.options).toEqual(['w', 'x', 'y', 'z']);
    expect(updated.correctAnswer).toBe(2);
  });
});
