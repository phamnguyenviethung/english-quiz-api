import { describe, expect, it } from 'bun:test';
import { parseExcludeIds } from '@/api/controllers/english.controller';

/**
 * `excludeIds` là cơ chế chống lặp câu phía client (pool không biết end-user là ai).
 * Nó là filter "best effort": input rác chỉ làm mất tác dụng lọc, KHÔNG được làm hỏng request —
 * bot gửi query string méo vẫn phải lấy được câu hỏi.
 */
describe('parseExcludeIds', () => {
  it('không truyền / rỗng -> mảng rỗng (không lọc gì)', () => {
    expect(parseExcludeIds(undefined)).toEqual([]);
    expect(parseExcludeIds('')).toEqual([]);
  });

  it('parse CSV thường', () => {
    expect(parseExcludeIds('1,2,3')).toEqual([1, 2, 3]);
  });

  it('bỏ qua khoảng trắng thừa', () => {
    expect(parseExcludeIds(' 1 , 2 ,3 ')).toEqual([1, 2, 3]);
  });

  it('bỏ qua rác thay vì throw', () => {
    expect(parseExcludeIds('1,abc,,2,NaN,3')).toEqual([1, 2, 3]);
  });

  it('loại số <= 0 và số thập phân (id pool là serial dương)', () => {
    expect(parseExcludeIds('0,-5,1.5,7')).toEqual([7]);
  });

  it('khử trùng lặp, giữ thứ tự xuất hiện đầu tiên', () => {
    expect(parseExcludeIds('3,1,3,2,1')).toEqual([3, 1, 2]);
  });

  it('cắt tối đa 200 id để query string không phình vô hạn', () => {
    const raw = Array.from({ length: 500 }, (_, i) => i + 1).join(',');
    const parsed = parseExcludeIds(raw);
    expect(parsed).toHaveLength(200);
    expect(parsed[0]).toBe(1);
    expect(parsed.at(-1)).toBe(200);
  });

  it('toàn rác -> mảng rỗng, không ném lỗi', () => {
    expect(parseExcludeIds('abc,,;,%%')).toEqual([]);
  });
});
