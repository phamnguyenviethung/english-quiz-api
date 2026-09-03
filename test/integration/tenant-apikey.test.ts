import { beforeEach, describe, expect, it } from 'bun:test';
import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService, { API_KEY_PREFIX } from '@/core/services/tenant/apiKey.service';
import { BusinessLogicException, ConflictException, NotFoundException } from '@/core/exceptions';
import { resetDb } from '../helpers/db.helper';
import { createTopic } from '../helpers/seed.helper';

beforeEach(async () => {
  await resetDb();
});

describe('API key', () => {
  it('key có prefix eqk_ + 48 hex và chỉ trả plaintext đúng một lần', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    const { record, plaintext } = await apiKeyService.issueKey(t.id, 'main');

    expect(plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(plaintext.slice(API_KEY_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
    expect(record.label).toBe('main');

    const listed = await apiKeyService.listKeys(t.id);
    expect(listed).toHaveLength(1);
    expect('key' in listed[0]!).toBe(false); // không lộ key khi list
  });

  it('mỗi lần issue ra key khác nhau', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    const a = await apiKeyService.issueKey(t.id);
    const b = await apiKeyService.issueKey(t.id);
    expect(a.plaintext).not.toBe(b.plaintext);
  });

  it('issue cho tenant không tồn tại -> NotFoundException', async () => {
    expect(apiKeyService.issueKey(999999)).rejects.toThrow(NotFoundException);
  });

  it('verifyKey trả TenantContext đúng quyền', async () => {
    const topic = await createTopic('daily-life');
    const t = await tenantService.createTenant({ name: 'bot' });
    await tenantService.setTopicAccess(t.id, [topic.id]);
    await tenantService.setQuizTypeAccess(t.id, ['vocab']);
    const { plaintext } = await apiKeyService.issueKey(t.id);

    const ctx = await apiKeyService.verifyKey(plaintext);

    expect(ctx).toMatchObject({
      id: t.id,
      name: 'bot',
      allowAllTopics: false,
      allowedTopicIds: [topic.id],
      allowAllQuizTypes: false,
      allowedQuizTypes: ['vocab']
    });
  });

  it('key sai / rỗng / có khoảng trắng thừa', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    const { plaintext } = await apiKeyService.issueKey(t.id);

    expect(await apiKeyService.verifyKey('eqk_khong-ton-tai')).toBeNull();
    expect(await apiKeyService.verifyKey('')).toBeNull();
    expect(await apiKeyService.verifyKey('   ')).toBeNull();
    expect(await apiKeyService.verifyKey(`  ${plaintext}  `)).not.toBeNull(); // trim
  });

  it('key đã revoke -> verify trả null', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    const { record, plaintext } = await apiKeyService.issueKey(t.id);

    await apiKeyService.revokeKey(t.id, record.id);

    expect(await apiKeyService.verifyKey(plaintext)).toBeNull();
  });

  it('revoke key của tenant khác -> NotFoundException (không rò rỉ key chéo tenant)', async () => {
    const a = await tenantService.createTenant({ name: 'a' });
    const b = await tenantService.createTenant({ name: 'b' });
    const { record } = await apiKeyService.issueKey(a.id);

    expect(apiKeyService.revokeKey(b.id, record.id)).rejects.toThrow(NotFoundException);
  });

  it('tenant bị deactivate -> key còn active vẫn verify ra null', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    const { plaintext } = await apiKeyService.issueKey(t.id);

    await tenantService.deactivateTenant(t.id);

    expect(await apiKeyService.verifyKey(plaintext)).toBeNull();
  });
});

describe('tenant CRUD', () => {
  it('tên trùng -> ConflictException (map từ PG 23505)', async () => {
    await tenantService.createTenant({ name: 'trung-ten' });
    expect(tenantService.createTenant({ name: 'trung-ten' })).rejects.toThrow(ConflictException);
  });

  it('đổi tên sang tên đã tồn tại -> ConflictException', async () => {
    await tenantService.createTenant({ name: 'a' });
    const b = await tenantService.createTenant({ name: 'b' });
    expect(tenantService.updateTenant(b.id, { name: 'a' })).rejects.toThrow(ConflictException);
  });

  it('update tenant không tồn tại -> NotFoundException', async () => {
    expect(tenantService.updateTenant(999999, { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('mặc định KHÔNG cho phép gì (allowAll* = false)', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    expect(t.allowAllTopics).toBe(false);
    expect(t.allowAllQuizTypes).toBe(false);

    const ctx = await tenantService.getTenantContext(t.id);
    expect(ctx?.allowedTopicIds).toEqual([]);
    expect(ctx?.allowedQuizTypes).toEqual([]);
  });
});

describe('allow-list là REPLACE-ALL, không phải merge', () => {
  it('setTopicAccess thay thế toàn bộ danh sách cũ', async () => {
    const t1 = await createTopic('t1');
    const t2 = await createTopic('t2');
    const t3 = await createTopic('t3');
    const tn = await tenantService.createTenant({ name: 'bot' });

    await tenantService.setTopicAccess(tn.id, [t1.id, t2.id]);
    await tenantService.setTopicAccess(tn.id, [t3.id]);

    expect(await tenantService.getAllowedTopicIds(tn.id)).toEqual([t3.id]);
  });

  it('truyền mảng rỗng = thu hồi hết quyền', async () => {
    const t1 = await createTopic('t1');
    const tn = await tenantService.createTenant({ name: 'bot' });

    await tenantService.setTopicAccess(tn.id, [t1.id]);
    await tenantService.setTopicAccess(tn.id, []);

    expect(await tenantService.getAllowedTopicIds(tn.id)).toEqual([]);
  });

  it('khử trùng lặp trong input', async () => {
    const t1 = await createTopic('t1');
    const tn = await tenantService.createTenant({ name: 'bot' });

    const result = await tenantService.setTopicAccess(tn.id, [t1.id, t1.id, t1.id]);

    expect(result).toEqual([t1.id]);
    expect(await tenantService.getAllowedTopicIds(tn.id)).toEqual([t1.id]);
  });

  it('topic không tồn tại -> BusinessLogicException và KHÔNG đụng danh sách cũ', async () => {
    const t1 = await createTopic('t1');
    const tn = await tenantService.createTenant({ name: 'bot' });
    await tenantService.setTopicAccess(tn.id, [t1.id]);

    expect(tenantService.setTopicAccess(tn.id, [t1.id, 999999])).rejects.toThrow(BusinessLogicException);

    expect(await tenantService.getAllowedTopicIds(tn.id)).toEqual([t1.id]);
  });

  it('quizType không hợp lệ -> BusinessLogicException', async () => {
    const tn = await tenantService.createTenant({ name: 'bot' });
    expect(tenantService.setQuizTypeAccess(tn.id, ['vocab', 'khong-ton-tai'])).rejects.toThrow(BusinessLogicException);
  });

  it('setQuizTypeAccess replace-all', async () => {
    const tn = await tenantService.createTenant({ name: 'bot' });
    await tenantService.setQuizTypeAccess(tn.id, ['vocab', 'idiom']);
    await tenantService.setQuizTypeAccess(tn.id, ['slang']);

    expect(await tenantService.getAllowedQuizTypes(tn.id)).toEqual(['slang']);
  });
});

describe('getTenantContext', () => {
  it('tenant không tồn tại -> null', async () => {
    expect(await tenantService.getTenantContext(999999)).toBeNull();
  });

  it('tenant inactive -> null', async () => {
    const t = await tenantService.createTenant({ name: 'bot' });
    await tenantService.deactivateTenant(t.id);
    expect(await tenantService.getTenantContext(t.id)).toBeNull();
  });

  it('allowAll* = true thì không cần allow-list', async () => {
    const t = await tenantService.createTenant({ name: 'bot', allowAllTopics: true, allowAllQuizTypes: true });
    const ctx = await tenantService.getTenantContext(t.id);

    expect(ctx?.allowAllTopics).toBe(true);
    expect(ctx?.allowAllQuizTypes).toBe(true);
  });
});
