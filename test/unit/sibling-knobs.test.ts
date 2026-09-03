import { describe, expect, it } from 'bun:test';
import { resolveKnobs } from '@/core/services/english/siblingRefill.service';
import { SIBLING_MAX_PER_CALL } from '@/core/services/english/siblingQuestion.service';
import { getEnglishConfigSnapshot } from '@/core/services/english/englishConfig.service';

/**
 * `siblingsPerSource` đi thẳng vào `z.array(...).max(5)` của batch schema. Không clamp ở đây
 * thì mọi lời gọi LLM của bucket đó fail schema — tốn token, bucket không bao giờ đầy.
 */
describe('resolveKnobs', () => {
  it('không truyền gì -> lấy từ config', () => {
    const cfg = getEnglishConfigSnapshot().sibling_gen;
    expect(resolveKnobs({})).toEqual({
      sourcesPerBucket: cfg.sourcesPerBucketPerRun,
      siblingsPerSource: cfg.siblingsPerSource
    });
  });

  it('clamp siblingsPerSource xuống trần 5 của batch schema', () => {
    expect(resolveKnobs({ siblingsPerSource: 99 }).siblingsPerSource).toBe(SIBLING_MAX_PER_CALL);
    expect(SIBLING_MAX_PER_CALL).toBe(5);
  });

  it('giá trị < 1 được nâng lên 1 (0 sẽ làm phép chia ceil() vô nghĩa)', () => {
    expect(resolveKnobs({ siblingsPerSource: 0 }).siblingsPerSource).toBe(1);
    expect(resolveKnobs({ siblingsPerSource: -5 }).siblingsPerSource).toBe(1);
    expect(resolveKnobs({ sourcesPerBucket: 0 }).sourcesPerBucket).toBe(1);
    expect(resolveKnobs({ sourcesPerBucket: -2 }).sourcesPerBucket).toBe(1);
  });

  it('cắt phần thập phân thay vì làm tròn', () => {
    expect(resolveKnobs({ siblingsPerSource: 3.9 }).siblingsPerSource).toBe(3);
    expect(resolveKnobs({ sourcesPerBucket: 2.9 }).sourcesPerBucket).toBe(2);
  });

  it('giá trị hợp lệ đi qua nguyên vẹn', () => {
    expect(resolveKnobs({ sourcesPerBucket: 4, siblingsPerSource: 2 })).toEqual({
      sourcesPerBucket: 4,
      siblingsPerSource: 2
    });
  });
});
