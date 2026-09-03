import { describe, expect, it } from 'bun:test';
import random, { type ChanceOption } from '@/utils/chance';

/**
 * Bộ chọn ngẫu nhiên có trọng số, đứng sau `pickQuizType()` — quyết định tỉ lệ xuất hiện của
 * 11 loại câu hỏi. Đây là test ĐẶC TẢ HÀNH VI HIỆN TẠI (characterization), không phải đặc tả
 * lý tưởng: xem ghi chú "lệch phân phối" ở cuối file.
 */
describe('random (weighted pick)', () => {
  it('mảng rỗng -> throw', () => {
    expect(() => random([])).toThrow('Options array must not be empty');
  });

  it('một lựa chọn duy nhất thì luôn trả về nó', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(random([{ percentage: 100, value: 'vocab' }])).toBe('vocab');
    }
  });

  it('chỉ trả về giá trị nằm trong danh sách', () => {
    const options: ChanceOption<string>[] = [
      { percentage: 50, value: 'a' },
      { percentage: 30, value: 'b' },
      { percentage: 20, value: 'c' }
    ];
    const allowed = new Set(['a', 'b', 'c']);

    for (let i = 0; i < 500; i += 1) {
      expect(allowed.has(random(options.map((o) => ({ ...o }))))).toBe(true);
    }
  });

  it('trọng số lớn được chọn nhiều hơn hẳn trọng số nhỏ', () => {
    let heavy = 0;
    const runs = 3000;
    for (let i = 0; i < runs; i += 1) {
      const picked = random([
        { percentage: 90, value: 'heavy' },
        { percentage: 10, value: 'light' }
      ]);
      if (picked === 'heavy') heavy += 1;
    }

    // Biên rộng có chủ đích: khẳng định "áp đảo", không khoá vào con số chính xác.
    expect(heavy / runs).toBeGreaterThan(0.75);
    expect(heavy / runs).toBeLessThan(0.98);
  });

  it('mọi lựa chọn có trọng số đều có cơ hội xuất hiện', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(
        random([
          { percentage: 60, value: 'a' },
          { percentage: 25, value: 'b' },
          { percentage: 15, value: 'c' }
        ])
      );
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  /**
   * Hành vi hiện tại: random() gọi `options.sort()` -> SẮP XẾP TẠI CHỖ, mutate mảng của caller.
   * Chưa gây lỗi thật vì mọi call site đều dựng mảng mới ngay trước khi gọi, nhưng đây là bẫy
   * cho call site tương lai. Khoá lại bằng test để việc sửa (copy trước khi sort) là một thay
   * đổi có ý thức, không phải tình cờ. Xem test/notes/FINDINGS.md.
   */
  it('[đặc tả hiện trạng] sắp xếp tại chỗ mảng options của caller', () => {
    const options: ChanceOption<string>[] = [
      { percentage: 90, value: 'heavy' },
      { percentage: 10, value: 'light' }
    ];
    random(options);
    expect(options.map((o) => o.value)).toEqual(['light', 'heavy']);
  });
});
