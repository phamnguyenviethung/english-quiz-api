import { describe, expect, it } from 'bun:test';
import { bucketKeyOf } from '@/core/services/english/poolRefill.service';

/**
 * bucketKey là khoá nối giữa hai module KHÁC FILE:
 *   - poolRefill.bucketKeyOf()                  (sinh key lúc scan/plan)
 *   - questionPool.getPoolCountsByBucket()      (sinh key lúc đếm, bằng SQL + template riêng)
 * Lệch format là scan đọc count = 0 cho mọi bucket -> refill vô tận. Test này khoá đúng
 * format chuỗi; phép so khớp thật với dữ liệu DB nằm ở integration/question-pool.test.ts.
 */
describe('bucketKeyOf', () => {
  it('format là `engLevel:topicId:quizType`', () => {
    expect(bucketKeyOf({ engLevel: 'A1', topicId: 7, quizType: 'vocab' })).toBe('A1:7:vocab');
  });

  it("topicId = null được mã hoá thành chuỗi 'null', không phải rỗng", () => {
    expect(bucketKeyOf({ engLevel: 'B2', topicId: null, quizType: 'idiom' })).toBe('B2:null:idiom');
  });

  it('bucket không topic khác hẳn bucket topic bất kỳ', () => {
    const noTopic = bucketKeyOf({ engLevel: 'A1', topicId: null, quizType: 'vocab' });
    const topic1 = bucketKeyOf({ engLevel: 'A1', topicId: 1, quizType: 'vocab' });
    expect(noTopic).not.toBe(topic1);
  });

  it('quizType có dấu gạch ngang không phá cấu trúc key', () => {
    expect(bucketKeyOf({ engLevel: 'B1', topicId: 3, quizType: 'odd-one-out' })).toBe('B1:3:odd-one-out');
    expect(bucketKeyOf({ engLevel: 'B1', topicId: 3, quizType: 'verb-use-match' })).toBe('B1:3:verb-use-match');
  });
});
