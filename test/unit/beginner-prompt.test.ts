import { describe, expect, it } from 'bun:test';
import { buildLevelInstruction } from '@/core/services/english/study.service';
import type { DifficultyContext } from '@/core/services/english/prompt/vocab-prompt';
import { buildReadingPassagePrompt } from '@/core/services/english/prompt/reading-passage-prompt';
import { buildReadingQuestionPrompt } from '@/core/services/english/prompt/reading-question';
import { buildReviewPrompt } from '@/core/services/english/prompt/review-prompt';
import { buildSiblingPrompt } from '@/core/services/english/prompt/sibling-prompt';
import { EnglishConfigDefaults, EnglishConfigSchemas } from '@/core/services/english/englishConfig.defaults';
import { bucketKeyOf } from '@/core/services/english/poolRefill.service';
import { readingBucketKeyOf } from '@/core/services/english/readingRefill.service';

/**
 * Prompt beginner dựng CHỒNG lên prompt gốc: base prompt giữ nguyên, khối cuối thay
 * EXPERT LEARNER MODE bằng BEGINNER MODE (≤ B1, từ vựng thường ngày / SGK Cambridge,
 * tối đa 4 đáp án). Xem docs/beginner.md.
 */

function ctx(overrides: Partial<DifficultyContext> = {}): DifficultyContext {
  return { engLevel: 'A2', optionCount: 4, show5050: true, model: 'test/model', ...overrides };
}

describe('khối độ khó cho câu hỏi pool', () => {
  it('câu beginner nhận BEGINNER MODE thay cho EXPERT LEARNER MODE', () => {
    const prompt = buildLevelInstruction(ctx({ forBeginner: true }), 'vocab');

    expect(prompt).toContain('BEGINNER MODE');
    expect(prompt).not.toContain('EXPERT LEARNER MODE');
  });

  it('câu thường vẫn giữ nguyên EXPERT LEARNER MODE như trước', () => {
    const prompt = buildLevelInstruction(ctx(), 'vocab');

    expect(prompt).toContain('EXPERT LEARNER MODE');
    expect(prompt).not.toContain('BEGINNER MODE');
  });

  it('độ khó beginner tối đa là B1 và bám từ vựng thông dụng trong wordlist/SGK Cambridge', () => {
    const prompt = buildLevelInstruction(ctx({ forBeginner: true }), 'vocab');

    expect(prompt).toContain('Maximum level: B1');
    expect(prompt).toContain('Cambridge');
    expect(prompt).toMatch(/everyday words/i);
  });

  it('level B2 lọt vào luồng beginner bị hạ về trần B1', () => {
    const prompt = buildLevelInstruction(ctx({ forBeginner: true, engLevel: 'B2', optionCount: 4 }), 'vocab');

    expect(prompt).toContain('Target level for this item: B1');
    expect(prompt).not.toContain('Target level for this item: B2');
  });

  it('câu beginner có tối đa 4 đáp án — 5 đáp án bị ép về 3 distractor', () => {
    expect(buildLevelInstruction(ctx({ forBeginner: true, optionCount: 4 }), 'vocab')).toContain('EXACTLY 3 items');
    expect(buildLevelInstruction(ctx({ forBeginner: true, optionCount: 3 }), 'vocab')).toContain('EXACTLY 2 items');
    expect(buildLevelInstruction(ctx({ forBeginner: true, optionCount: 5 }), 'vocab')).toContain('EXACTLY 3 items');
  });

  it('vocab beginner bỏ danh sách DOMAIN A–G khó và danh sách từ phổ thông bị cấm của prompt gốc', () => {
    const prompt = buildLevelInstruction(ctx({ forBeginner: true }), 'vocab');

    expect(prompt).toContain('IGNORE DOMAIN A–G');
    expect(prompt).toMatch(/IGNORE the banned "overused quiz words" list/);
  });

  it('mỗi loại câu beginner có hướng dẫn riêng phù hợp loại đó', () => {
    expect(buildLevelInstruction(ctx({ forBeginner: true }), 'odd-one-out')).toContain('BEGINNER GROUPS');
    expect(buildLevelInstruction(ctx({ forBeginner: true }), 'verb-use-match')).toContain('BEGINNER COLLOCATIONS');
    expect(buildLevelInstruction(ctx({ forBeginner: true }), 'conversation')).toContain('BEGINNER DIALOGUE');
  });
});

describe('prompt bài đọc và câu hỏi đọc hiểu', () => {
  it('bài đọc beginner dùng khối BEGINNER TRACK, bài thường thì không', () => {
    const beginner = buildReadingPassagePrompt({ topicName: 'Food', cefrLevel: 'A2', forBeginner: true });
    const standard = buildReadingPassagePrompt({ topicName: 'Food', cefrLevel: 'A2' });

    expect(beginner).toContain('BEGINNER TRACK');
    expect(beginner).toContain('Cambridge');
    expect(standard).not.toContain('BEGINNER TRACK');
  });

  it('câu hỏi của bài beginner được viết theo chuẩn beginner', () => {
    const input = {
      quizType: 'detail' as const,
      title: 'A day at school',
      paragraphs: ['Tom goes to school by bus.', 'He eats lunch with his friends.'],
      cefrLevel: 'A1' as const,
      topicName: 'School'
    };

    expect(buildReadingQuestionPrompt({ ...input, forBeginner: true })).toContain('BEGINNER TRACK');
    expect(buildReadingQuestionPrompt(input)).not.toContain('BEGINNER TRACK');
  });
});

describe('review và sinh câu tương tự giữ chuẩn beginner của câu gốc', () => {
  it('review câu beginner soi theo chuẩn beginner và gắn cờ từ khó', () => {
    const prompt = buildReviewPrompt('vocab', ctx({ forBeginner: true }));

    expect(prompt).toContain('beginner track');
    expect(prompt).toContain('This is a BEGINNER item (maximum B1)');
  });

  it('sibling của câu beginner được giữ ở chuẩn beginner', () => {
    const prompt = buildSiblingPrompt('vocab', ctx({ forBeginner: true }), {
      lockedValues: { word: 'kitchen', partOfSpeech: 'noun' },
      count: 1
    });

    expect(prompt).toContain('beginner track');
  });
});

describe('config beginner_quiz_types', () => {
  it('mặc định hợp lệ, bật phần lớn loại câu nhưng tắt slang và idiom', () => {
    const defaults = EnglishConfigDefaults.beginner_quiz_types;
    expect(EnglishConfigSchemas.beginner_quiz_types.safeParse(defaults).success).toBe(true);

    const disabled = defaults.filter((item) => !item.enabled).map((item) => item.quizType);
    expect(disabled.sort()).toEqual(['idiom', 'slang']);
  });

  it('một loại câu khai hai lần bị từ chối', () => {
    const items = [
      { quizType: 'vocab', enabled: true },
      { quizType: 'vocab', enabled: false }
    ];
    expect(EnglishConfigSchemas.beginner_quiz_types.safeParse(items).success).toBe(false);
  });
});

describe('bucket beginner tách khỏi bucket thường', () => {
  it('bucket beginner có hậu tố riêng, bucket thường giữ format cũ', () => {
    expect(bucketKeyOf({ engLevel: 'A1', topicId: 7, quizType: 'vocab' })).toBe('A1:7:vocab');
    expect(bucketKeyOf({ engLevel: 'A1', topicId: 7, quizType: 'vocab', forBeginner: false })).toBe('A1:7:vocab');
    expect(bucketKeyOf({ engLevel: 'A1', topicId: 7, quizType: 'vocab', forBeginner: true })).toBe(
      'A1:7:vocab:beginner'
    );
  });

  it('bucket bài đọc beginner cũng tách riêng', () => {
    expect(readingBucketKeyOf({ cefrLevel: 'A2', topicId: 3, type: 'daily' })).toBe('A2:3:daily');
    expect(readingBucketKeyOf({ cefrLevel: 'A2', topicId: 3, type: 'daily', forBeginner: true })).toBe(
      'A2:3:daily:beginner'
    );
  });
});
