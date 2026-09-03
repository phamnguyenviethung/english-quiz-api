import { describe, expect, it } from 'bun:test';
import { computeCostUsd } from '@/core/services/ai/aiModel.service';

/**
 * Phân biệt `null` (chưa biết giá) với `0` (model free) là một quyết định nghiệp vụ có chủ đích:
 * dashboard cộng chi phí, đổi null thành 0 sẽ báo "chạy miễn phí" cho model chưa sync giá.
 */
describe('computeCostUsd', () => {
  it('model null -> null (không suy ra 0)', () => {
    expect(computeCostUsd(null, 1000, 500)).toBeNull();
    expect(computeCostUsd(undefined, 1000, 500)).toBeNull();
  });

  it('model chưa có giá nào -> null', () => {
    expect(computeCostUsd({ pricePromptPerToken: null, priceCompletionPerToken: null }, 1000, 500)).toBeNull();
  });

  it('model free (giá 0) -> 0, khác hẳn null', () => {
    expect(computeCostUsd({ pricePromptPerToken: 0, priceCompletionPerToken: 0 }, 1000, 500)).toBe(0);
  });

  it('cộng đúng prompt + completion', () => {
    const cost = computeCostUsd({ pricePromptPerToken: 0.000002, priceCompletionPerToken: 0.000008 }, 1000, 500);
    expect(cost).toBeCloseTo(0.000002 * 1000 + 0.000008 * 500, 12);
  });

  it('chỉ có một nửa giá thì nửa còn lại tính là 0', () => {
    expect(computeCostUsd({ pricePromptPerToken: 0.00001, priceCompletionPerToken: null }, 100, 999)).toBeCloseTo(
      0.001,
      12
    );
  });
});
