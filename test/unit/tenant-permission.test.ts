import { describe, expect, it } from 'bun:test';
import {
  ADMIN_TENANT,
  assertQuizTypeAllowed,
  assertTopicAllowed,
  extractBearer
} from '@/api/plugins/tenantAuth.plugin';
import { ForbiddenException } from '@/core/exceptions';
import type { TenantContext } from '@/core/services/tenant/tenant.service';

function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    id: 1,
    name: 'bot',
    allowAllTopics: false,
    allowedTopicIds: [],
    allowAllQuizTypes: false,
    allowedQuizTypes: [],
    ...overrides
  };
}

describe('assertTopicAllowed', () => {
  it('topicId = null luôn được phép (bucket "không topic" là dùng chung)', () => {
    expect(() => assertTopicAllowed(tenant(), null)).not.toThrow();
  });

  it('allowAllTopics bỏ qua allow-list', () => {
    expect(() => assertTopicAllowed(tenant({ allowAllTopics: true }), 999)).not.toThrow();
  });

  it('topic trong allow-list thì qua', () => {
    expect(() => assertTopicAllowed(tenant({ allowedTopicIds: [1, 2] }), 2)).not.toThrow();
  });

  it('topic ngoài allow-list -> ForbiddenException', () => {
    expect(() => assertTopicAllowed(tenant({ allowedTopicIds: [1, 2] }), 3)).toThrow(ForbiddenException);
  });

  it('tenant không có topic nào thì mọi topic cụ thể đều bị chặn', () => {
    expect(() => assertTopicAllowed(tenant(), 1)).toThrow(ForbiddenException);
  });
});

describe('assertQuizTypeAllowed', () => {
  it('allowAllQuizTypes bỏ qua allow-list', () => {
    expect(() => assertQuizTypeAllowed(tenant({ allowAllQuizTypes: true }), 'vocab')).not.toThrow();
  });

  it('quizType trong allow-list thì qua, ngoài thì Forbidden', () => {
    const ctx = tenant({ allowedQuizTypes: ['vocab', 'idiom'] });
    expect(() => assertQuizTypeAllowed(ctx, 'idiom')).not.toThrow();
    expect(() => assertQuizTypeAllowed(ctx, 'slang')).toThrow(ForbiddenException);
  });
});

describe('ADMIN_TENANT là super key', () => {
  it('bỏ qua mọi allow-list và tự nhận là admin', () => {
    expect(ADMIN_TENANT.isAdmin).toBe(true);
    expect(ADMIN_TENANT.allowAllTopics).toBe(true);
    expect(ADMIN_TENANT.allowAllQuizTypes).toBe(true);
    expect(() => assertTopicAllowed(ADMIN_TENANT, 12345)).not.toThrow();
    expect(() => assertQuizTypeAllowed(ADMIN_TENANT, 'bat-ky-loai-nao')).not.toThrow();
  });

  it('id = 0 — context ảo, không ứng với tenant row nào', () => {
    expect(ADMIN_TENANT.id).toBe(0);
  });
});

describe('extractBearer', () => {
  it('thiếu header -> null', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
  });

  it('scheme sai -> null', () => {
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer('eqk_khong-co-scheme')).toBeNull();
  });

  it('thiếu token sau scheme -> null', () => {
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer ')).toBeNull();
  });

  it('scheme không phân biệt hoa thường', () => {
    expect(extractBearer('Bearer eqk_abc')).toBe('eqk_abc');
    expect(extractBearer('bearer eqk_abc')).toBe('eqk_abc');
    expect(extractBearer('BEARER eqk_abc')).toBe('eqk_abc');
  });
});
