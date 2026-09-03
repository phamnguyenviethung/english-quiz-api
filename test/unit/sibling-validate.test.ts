import { describe, expect, it } from 'bun:test';
import {
  contextSignature,
  normalizeText,
  safeJsonParse,
  validateCandidate
} from '@/core/services/english/sibling.validators';
import {
  conversationQuestion,
  descriptionQuestion,
  fillblankQuestion,
  vocabQuestion
} from '../fixtures/pool-question.fixture';

/**
 * Bốn cổng validate của sibling (docs/sibling-question.md §"Validate"):
 *  1. đúng schema của loại,
 *  2. field khóa (term cần học) được KHÔI PHỤC nguyên văn nếu model lỡ đổi — cảnh báo chứ
 *     không loại cả câu,
 *  3. mọi mảng distractor có đúng optionCount - 1 phần tử và ăn khớp chỉ số,
 *  4. ngữ cảnh phải THẬT SỰ khác câu gốc (chống model trả lại gần như y hệt).
 */

describe('validateCandidate — cổng 1: schema', () => {
  it('candidate không phải object -> loại', () => {
    const source = vocabQuestion();
    expect(validateCandidate('vocab', source, 'chuỗi', 4)).toMatchObject({ ok: false });
    expect(validateCandidate('vocab', source, null, 4)).toMatchObject({ ok: false });
  });

  it('thiếu field bắt buộc -> loại kèm lý do nhắc tới schema', () => {
    const source = vocabQuestion();
    const broken = { ...vocabQuestion({ overrides: { correctAnswer: 'khác hẳn' } }) };
    delete broken.explanation;

    const result = validateCandidate('vocab', source, broken, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Sai schema');
  });
});

describe('validateCandidate — cổng 2: khóa field term', () => {
  it('model đổi field khóa thì KHÔI PHỤC từ câu gốc + warning, không loại câu', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: {
        word: 'lazy', // field khóa bị đổi
        correctAnswer: 'lười biếng',
        wrongAnswers: ['a', 'b', 'c'],
        exampleSentence: 'A completely different example.'
      }
    });

    const result = validateCandidate('vocab', source, candidate, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.word).toBe('diligent'); // khôi phục từ câu gốc
      expect(result.warnings.some((w) => w.includes('word'))).toBe(true);
    }
  });

  it('không đổi field khóa thì không sinh warning thừa', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: { correctAnswer: 'siêng năng', wrongAnswers: ['x', 'y', 'z'], exampleSentence: 'Another one.' }
    });

    const result = validateCandidate('vocab', source, candidate, 4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('khóa cả nhiều field cùng lúc (description khóa 3 field)', () => {
    const source = descriptionQuestion();
    const candidate = descriptionQuestion({
      overrides: {
        correctAnswer: 'electrician',
        partOfSpeech: 'verb',
        descriptionLanguage: 'en',
        description: 'This person installs wiring.'
      }
    });

    const result = validateCandidate('description', source, candidate, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.correctAnswer).toBe('plumber');
      expect(result.data.partOfSpeech).toBe('noun');
      expect(result.data.descriptionLanguage).toBe('vi');
      expect(result.warnings).toHaveLength(3);
    }
  });
});

describe('validateCandidate — cổng 3: độ dài mảng distractor', () => {
  it('wrongAnswers thiếu phần tử -> loại', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: { wrongAnswers: ['chỉ có 1'], correctAnswer: 'khác', exampleSentence: 'Different.' }
    });

    const result = validateCandidate('vocab', source, candidate, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('wrongAnswers');
  });

  it('wrongAnswers thừa phần tử -> loại', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: { wrongAnswers: ['a', 'b', 'c', 'd'], correctAnswer: 'khác', exampleSentence: 'Different.' }
    });

    expect(validateCandidate('vocab', source, candidate, 4).ok).toBe(false);
  });

  it('wrongAnswerExplanations lệch với wrongAnswers -> loại (mất ăn khớp chỉ số)', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: {
        wrongAnswers: ['a', 'b', 'c'],
        wrongAnswerExplanations: ['chỉ 1'],
        correctAnswer: 'khác',
        exampleSentence: 'Different.'
      }
    });

    const result = validateCandidate('vocab', source, candidate, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('wrongAnswerExplanations');
  });

  it('optionTranslations lệch -> loại (loại fillblank có thêm mảng này)', () => {
    const source = fillblankQuestion();
    const candidate = fillblankQuestion({
      overrides: {
        sentence: 'A totally new sentence with ____ inside.',
        optionTranslations: ['chỉ 1'],
        exampleSentence: 'New example.'
      }
    });

    const result = validateCandidate('fillblank', source, candidate, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('optionTranslations');
  });

  it('optionCount = 5 thì cần đúng 4 distractor', () => {
    const source = vocabQuestion({ optionCount: 5 });
    const ok = vocabQuestion({
      optionCount: 5,
      overrides: { correctAnswer: 'khác', exampleSentence: 'Different.' }
    });
    const notOk = vocabQuestion({
      optionCount: 4,
      overrides: { correctAnswer: 'khác', exampleSentence: 'Different.' }
    });

    expect(validateCandidate('vocab', source, ok, 5).ok).toBe(true);
    expect(validateCandidate('vocab', source, notOk, 5).ok).toBe(false);
  });
});

describe('validateCandidate — cổng 4: chống trùng ngữ cảnh câu gốc', () => {
  it('trả lại y hệt câu gốc -> loại', () => {
    const source = vocabQuestion();
    const result = validateCandidate('vocab', source, vocabQuestion(), 4);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Ngữ cảnh trùng câu gốc');
  });

  it('chỉ đổi hoa/thường + khoảng trắng vẫn bị coi là trùng', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: {
        exampleSentence: '  THIS IS   AN EXAMPLE SENTENCE.  ',
        wrongAnswers: ['NGHĨA SAI 1', 'nghĩa sai 2', 'Nghĩa Sai 3']
      }
    });

    expect(validateCandidate('vocab', source, candidate, 4).ok).toBe(false);
  });

  it('đổi thật bộ distractor + ví dụ -> được nhận', () => {
    const source = vocabQuestion();
    const candidate = vocabQuestion({
      overrides: {
        wrongAnswers: ['lười nhác', 'hấp tấp', 'thờ ơ'],
        exampleSentence: 'He is a diligent student who never misses class.'
      }
    });

    expect(validateCandidate('vocab', source, candidate, 4).ok).toBe(true);
  });
});

describe('contextSignature — chọn đúng phần "ngữ cảnh" theo từng loại', () => {
  it('fillblank / verb-use-match dựa vào `sentence`', () => {
    const base = fillblankQuestion();
    const changedSentence = fillblankQuestion({ overrides: { sentence: 'Một câu hoàn toàn khác ____.' } });
    const changedOther = fillblankQuestion({ overrides: { explanation: 'giải thích khác hẳn' } });

    expect(contextSignature('fillblank', changedSentence)).not.toBe(contextSignature('fillblank', base));
    // explanation KHÔNG nằm trong chữ ký -> đổi mỗi nó vẫn bị coi là trùng ngữ cảnh.
    expect(contextSignature('fillblank', changedOther)).toBe(contextSignature('fillblank', base));
  });

  it('conversation dựa vào `dialogueLines`', () => {
    const base = conversationQuestion();
    const changed = conversationQuestion({ overrides: { dialogueLines: ['A: Hoàn toàn khác.', 'B: Đúng vậy.'] } });
    expect(contextSignature('conversation', changed)).not.toBe(contextSignature('conversation', base));
  });

  it('description dựa vào `description`', () => {
    const base = descriptionQuestion();
    const changed = descriptionQuestion({ overrides: { description: 'Người này dạy học ở trường.' } });
    expect(contextSignature('description', changed)).not.toBe(contextSignature('description', base));
  });

  it('vocab (không có câu ngữ cảnh riêng) dựa vào bộ wrongAnswers', () => {
    const base = vocabQuestion();
    const changed = vocabQuestion({ overrides: { wrongAnswers: ['khác 1', 'khác 2', 'khác 3'] } });
    expect(contextSignature('vocab', changed)).not.toBe(contextSignature('vocab', base));
  });
});

describe('helper thuần', () => {
  it('normalizeText: trim + hạ hoa thường + gộp khoảng trắng', () => {
    expect(normalizeText('  Xin   CHÀO  bạn ')).toBe('xin chào bạn');
  });

  it('normalizeText: giá trị không phải chuỗi -> chuỗi rỗng', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('');
    expect(normalizeText(null)).toBe('');
  });

  it('safeJsonParse: JSON hỏng trả null thay vì throw', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('khong-phai-json')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });
});
