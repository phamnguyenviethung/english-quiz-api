import { describe, expect, it } from 'bun:test';
import {
  buildDefaultEnglishConfigSnapshot,
  EnglishConfigDefaults,
  EnglishConfigSchemas,
  ENGLISH_CONFIG_RECORD_DEFINITIONS
} from '@/core/services/english/englishConfig.defaults';
import { assignPath, validateBasicValue } from '@/core/services/english/englishConfig.service';

/**
 * Config là thứ lái toàn bộ hành vi sinh câu hỏi lúc chạy. Ràng buộc chéo ở đây là lý do
 * `PATCH /english/config/records` (bulk) tồn tại song song với PATCH từng record —
 * xem docs/english-config.md.
 */

describe('ràng buộc chéo min <= default <= max', () => {
  const namespaces = ['question_pool', 'reading_passage', 'reading_question'] as const;

  for (const ns of namespaces) {
    it(`${ns}: default hợp lệ`, () => {
      expect(EnglishConfigSchemas[ns].safeParse(EnglishConfigDefaults[ns]).success).toBe(true);
    });

    it(`${ns}: min > default -> fail`, () => {
      const value = { ...EnglishConfigDefaults[ns], manualFillMinCount: 999 };
      expect(EnglishConfigSchemas[ns].safeParse(value).success).toBe(false);
    });

    it(`${ns}: default > max -> fail`, () => {
      const value = { ...EnglishConfigDefaults[ns], manualFillDefaultCount: 9999 };
      expect(EnglishConfigSchemas[ns].safeParse(value).success).toBe(false);
    });

    it(`${ns}: min = default = max là hợp lệ (biên)`, () => {
      const value = {
        ...EnglishConfigDefaults[ns],
        manualFillMinCount: 2,
        manualFillDefaultCount: 2,
        manualFillMaxCount: 2
      };
      expect(EnglishConfigSchemas[ns].safeParse(value).success).toBe(true);
    });
  }
});

describe('quiz_distribution', () => {
  it('default hợp lệ và có ít nhất một loại bật', () => {
    const parsed = EnglishConfigSchemas.quiz_distribution.safeParse(EnglishConfigDefaults.quiz_distribution);
    expect(parsed.success).toBe(true);
  });

  it('tắt hết -> fail (không còn loại nào để sinh câu)', () => {
    const items = EnglishConfigDefaults.quiz_distribution.map((item) => ({ ...item, enabled: false }));
    expect(EnglishConfigSchemas.quiz_distribution.safeParse(items).success).toBe(false);
  });

  it('còn bật nhưng weight = 0 hết -> fail', () => {
    const items = EnglishConfigDefaults.quiz_distribution.map((item) => ({ ...item, weight: 0 }));
    expect(EnglishConfigSchemas.quiz_distribution.safeParse(items).success).toBe(false);
  });

  it('chỉ cần một loại bật với weight > 0 là hợp lệ', () => {
    const items = EnglishConfigDefaults.quiz_distribution.map((item, i) => ({
      ...item,
      enabled: i === 0,
      weight: i === 0 ? 5 : 0
    }));
    expect(EnglishConfigSchemas.quiz_distribution.safeParse(items).success).toBe(true);
  });
});

describe('schedule', () => {
  const scheduleNamespaces = [
    'pool_refill_schedule',
    'sibling_gen_schedule',
    'reading_refill_schedule',
    'reading_question_refill_schedule'
  ] as const;

  for (const ns of scheduleNamespaces) {
    it(`${ns}: default hợp lệ`, () => {
      expect(EnglishConfigSchemas[ns].safeParse(EnglishConfigDefaults[ns]).success).toBe(true);
    });
  }

  it('cron sai cú pháp -> fail', () => {
    const items = [{ name: 'x', cron: 'khong-phai-cron', enabled: true }];
    expect(EnglishConfigSchemas.pool_refill_schedule.safeParse(items).success).toBe(false);
  });

  it('cron hợp lệ -> pass', () => {
    const items = [{ name: 'x', cron: '0 5 * * *', enabled: true }];
    expect(EnglishConfigSchemas.pool_refill_schedule.safeParse(items).success).toBe(true);
  });

  it('trùng `name` -> fail (name là khoá của job scheduler trong BullMQ)', () => {
    const items = [
      { name: 'trung', cron: '0 5 * * *', enabled: true },
      { name: 'trung', cron: '0 6 * * *', enabled: true }
    ];
    expect(EnglishConfigSchemas.pool_refill_schedule.safeParse(items).success).toBe(false);
  });
});

describe('trần 5 do batch schema của LLM', () => {
  it('sibling_gen.siblingsPerSource > 5 -> fail', () => {
    const value = { ...EnglishConfigDefaults.sibling_gen, siblingsPerSource: 6 };
    expect(EnglishConfigSchemas.sibling_gen.safeParse(value).success).toBe(false);
  });

  it('reading_question.questionsPerPassage > 5 -> fail', () => {
    const value = { ...EnglishConfigDefaults.reading_question, questionsPerPassage: 6 };
    expect(EnglishConfigSchemas.reading_question.safeParse(value).success).toBe(false);
  });
});

describe('snapshot mặc định', () => {
  it('mọi namespace của snapshot mặc định đều tự parse được', () => {
    const snapshot = buildDefaultEnglishConfigSnapshot();
    for (const key of Object.keys(EnglishConfigSchemas) as (keyof typeof EnglishConfigSchemas)[]) {
      const parsed = EnglishConfigSchemas[key].safeParse(snapshot[key]);
      if (!parsed.success) throw new Error(`namespace ${key} không parse được: ${parsed.error.message}`);
    }
  });

  it('mỗi lần build ra object mới (không chia sẻ tham chiếu giữa các lần reset)', () => {
    const a = buildDefaultEnglishConfigSnapshot();
    const b = buildDefaultEnglishConfigSnapshot();
    expect(a).not.toBe(b);
    expect(a.quiz_distribution).not.toBe(b.quiz_distribution);
    expect(a).toEqual(b);
  });

  it('mọi recordKey là duy nhất', () => {
    const keys = ENGLISH_CONFIG_RECORD_DEFINITIONS.map((def) => def.recordKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('validateBasicValue — validate theo kiểu record', () => {
  it('num: chặn không phải số, NaN, và ngoài khoảng', () => {
    expect(() => validateBasicValue('num', 'ba', { type: 'num' })).toThrow();
    expect(() => validateBasicValue('num', Number.NaN, { type: 'num' })).toThrow();
    expect(() => validateBasicValue('num', 5, { type: 'num', min: 1, max: 3 })).toThrow();
    expect(validateBasicValue('num', 2, { type: 'num', min: 1, max: 3 })).toBe(2);
  });

  it('num: cờ integer chặn số thập phân', () => {
    expect(() => validateBasicValue('num', 1.5, { type: 'num', integer: true })).toThrow();
    expect(validateBasicValue('num', 2, { type: 'num', integer: true })).toBe(2);
  });

  it('str: chặn sai kiểu và giá trị ngoài options', () => {
    expect(() => validateBasicValue('str', 1, { type: 'str' })).toThrow();
    expect(() => validateBasicValue('str', 'd', { type: 'str', options: ['a', 'b'] })).toThrow();
    expect(validateBasicValue('str', 'a', { type: 'str', options: ['a', 'b'] })).toBe('a');
  });

  it('boolean / arr / obj: chặn đúng kiểu', () => {
    expect(() => validateBasicValue('boolean', 'true', { type: 'boolean' })).toThrow();
    expect(validateBasicValue('boolean', false, { type: 'boolean' })).toBe(false);
    expect(() => validateBasicValue('arr', { a: 1 }, { type: 'arr' })).toThrow();
    expect(validateBasicValue('arr', [1], { type: 'arr' })).toEqual([1]);
    expect(() => validateBasicValue('obj', [1], { type: 'obj' })).toThrow();
    expect(validateBasicValue('obj', { a: 1 }, { type: 'obj' })).toEqual({ a: 1 });
  });
});

describe('assignPath', () => {
  it('gán path phẳng', () => {
    const target: Record<string, unknown> = {};
    assignPath(target, 'maxPerBucket', 5);
    expect(target).toEqual({ maxPerBucket: 5 });
  });

  it('tạo object trung gian cho path lồng nhau', () => {
    const target: Record<string, unknown> = {};
    assignPath(target, 'a.b.c', 1);
    expect(target).toEqual({ a: { b: { c: 1 } } });
  });

  it('không đè các key anh em đã có', () => {
    const target: Record<string, unknown> = { a: { existing: true } };
    assignPath(target, 'a.b', 2);
    expect(target).toEqual({ a: { existing: true, b: 2 } });
  });
});
