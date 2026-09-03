import { describe, expect, it } from 'bun:test';
import {
  CEFR_ALLOWED_QUESTION_TYPES,
  CEFR_COMPOSITION_SLOTS,
  isQuestionTypeAllowedForLevel,
  selectQuestionTypes
} from '@/core/services/english/readingQuestionTypes';
import type { EngLevel } from '@/core/services/english/questionTypes';

const LEVELS: EngLevel[] = ['A1', 'A2', 'B1', 'B2'];

/**
 * Việc chọn loại câu hỏi là ĐẢM BẢO CỦA SERVER, không phải lời nhờ vả trong prompt
 * (docs/reading-question.md §2). Test khoá 3 tính chất: đúng allow-list theo level,
 * slot 1 luôn là `detail` (câu neo), và không lặp type trong cùng một bài.
 */
describe('selectQuestionTypes', () => {
  for (const level of LEVELS) {
    it(`${level}: mọi type trả về đều nằm trong allow-list của level`, () => {
      const allowed = new Set<string>(CEFR_ALLOWED_QUESTION_TYPES[level]);
      for (let i = 0; i < 100; i += 1) {
        for (const type of selectQuestionTypes(level, 3)) {
          expect(allowed.has(type)).toBe(true);
        }
      }
    });

    it(`${level}: câu đầu tiên luôn là "detail" (câu neo, bài nào cũng đỡ được)`, () => {
      for (let i = 0; i < 50; i += 1) {
        expect(selectQuestionTypes(level, 3)[0]).toBe('detail');
      }
    });

    it(`${level}: không lặp type trong cùng một bài`, () => {
      for (let i = 0; i < 100; i += 1) {
        const types = selectQuestionTypes(level, 3);
        expect(new Set(types).size).toBe(types.length);
      }
    });

    it(`${level}: trả đúng số lượng yêu cầu`, () => {
      expect(selectQuestionTypes(level, 1)).toHaveLength(1);
      expect(selectQuestionTypes(level, 3)).toHaveLength(3);
    });

    it(`${level}: count vượt số slot vẫn đủ số lượng, lấy thêm từ allow-list`, () => {
      // A1 có 3 slot nhưng allow-list 5 type -> xin 5 phải ra 5, vẫn không trùng.
      const types = selectQuestionTypes(level, 5);
      expect(types).toHaveLength(5);
      expect(new Set(types).size).toBe(5);
    });
  }

  it('count = 0 -> mảng rỗng', () => {
    expect(selectQuestionTypes('A1', 0)).toEqual([]);
  });

  it('mỗi lần gọi có thể ra tổ hợp khác nhau (để retry bài hỏng đổi được đề)', () => {
    const combos = new Set<string>();
    for (let i = 0; i < 200; i += 1) combos.add(selectQuestionTypes('B2', 3).join(','));
    expect(combos.size).toBeGreaterThan(1);
  });
});

describe('cấu hình allow-list / slot', () => {
  it('mọi type trong composition slot đều thuộc allow-list của chính level đó', () => {
    for (const level of LEVELS) {
      const allowed = new Set<string>(CEFR_ALLOWED_QUESTION_TYPES[level]);
      for (const slot of CEFR_COMPOSITION_SLOTS[level]) {
        for (const type of slot) expect(allowed.has(type)).toBe(true);
      }
    }
  });

  it('slot đầu tiên của mọi level chỉ chứa detail', () => {
    for (const level of LEVELS) {
      expect(CEFR_COMPOSITION_SLOTS[level][0]).toEqual(['detail']);
    }
  });

  it('allow-list nhỏ nhất vẫn đủ 5 type — điều kiện để count tối đa 5 không phải lặp', () => {
    for (const level of LEVELS) {
      expect(CEFR_ALLOWED_QUESTION_TYPES[level].length).toBeGreaterThanOrEqual(5);
    }
  });

  it('isQuestionTypeAllowedForLevel phân biệt đúng theo level', () => {
    // inference chỉ mở từ B1 trở lên.
    expect(isQuestionTypeAllowedForLevel('inference', 'B1')).toBe(true);
    expect(isQuestionTypeAllowedForLevel('inference', 'A1')).toBe(false);
    expect(isQuestionTypeAllowedForLevel('khong-ton-tai', 'B2')).toBe(false);
  });
});
