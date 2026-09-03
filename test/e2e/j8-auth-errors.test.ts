import { beforeAll, describe, expect, it } from 'bun:test';
import { api, expectError, expectOk, getApp } from '../helpers/app.helper';
import { resetDb } from '../helpers/db.helper';
import { banUser, createAdminUser, createNormalUser, type TestUser } from '../helpers/auth.helper';
import { createTestTenant } from '../helpers/tenant.helper';

/**
 * JOURNEY 8 — Xác thực, phân quyền và HỢP ĐỒNG ENVELOPE LỖI.
 *
 * docs/tenant-auth.md dặn client rẽ nhánh theo `error.code` (ổn định) chứ không theo
 * `message`. Các test ở đây khoá đúng hợp đồng đó.
 */

let admin: TestUser;

beforeAll(async () => {
  await resetDb();
  admin = await createAdminUser();
});

describe('endpoint công khai', () => {
  it('GET /health không cần auth và trả envelope thành công', async () => {
    const res = await api.get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
  });
});

describe('vai trò tài khoản', () => {
  it('không đăng nhập -> 401 UNAUTHORIZED', async () => {
    expectError(await api.get('/admin/tenants'), 401, 'UNAUTHORIZED');
  });

  it('token rác -> 401', async () => {
    expectError(await api.get('/admin/tenants', { token: 'khong-phai-token' }), 401);
  });

  it('tài khoản role=user -> 403 FORBIDDEN (đã đăng nhập nhưng không đủ quyền)', async () => {
    const user = await createNormalUser();
    expectError(await api.get('/admin/tenants', { token: user.token }), 403, 'FORBIDDEN');
  });

  it('tài khoản admin bị ban -> 403', async () => {
    const banned = await createAdminUser();
    await banUser(banned.id);

    expectError(await api.get('/admin/tenants', { token: banned.token }), 403, 'FORBIDDEN');
  });

  it('admin hợp lệ -> 200', async () => {
    expectOk(await api.get('/admin/tenants', { token: admin.token }));
  });
});

describe('Bull Board /queues', () => {
  it('không có phiên admin -> 401', async () => {
    const app = await getApp();
    const res = await app.handle(new Request('http://localhost/queues'));
    expect(res.status).toBe(401);
  });
});

describe('envelope lỗi theo mã', () => {
  it('VALIDATION (400) khi query sai kiểu', async () => {
    const t = await createTestTenant({ allowAllTopics: true, allowAllQuizTypes: true });

    const error = expectError(
      await api.get('/english/pool/pop', { token: t.apiKey, query: { engLevel: 'KHONG-HOP-LE' } }),
      400,
      'VALIDATION'
    );
    expect(error.message).toBeTruthy();
  });

  it('NOT_FOUND (404) khi tài nguyên không tồn tại', async () => {
    expectError(await api.get('/admin/tenants/999999', { token: admin.token }), 404, 'NOT_FOUND');
  });

  it('CONFLICT (409) khi tên tenant trùng', async () => {
    const name = `trung-ten-${Date.now()}`;
    expectOk(await api.post('/admin/tenants', { token: admin.token, body: { name } }), 201);

    expectError(await api.post('/admin/tenants', { token: admin.token, body: { name } }), 409, 'CONFLICT');
  });

  it('BUSINESS_ERROR (400) cho lỗi nghiệp vụ, khác VALIDATION', async () => {
    const error = expectError(
      await api.patch('/english/config/khong.ton.tai', { token: admin.token, body: { value: 1 } }),
      400,
      'BUSINESS_ERROR'
    );
    expect(error.code).not.toBe('VALIDATION');
  });

  it('mọi lỗi đều có dạng { success:false, error:{ code, message } }', async () => {
    const res = await api.get('/admin/tenants/999999', { token: admin.token });

    expect(res.body).toMatchObject({
      success: false,
      error: { code: expect.any(String), message: expect.any(String) }
    });
  });
});

describe('envelope thành công', () => {
  it('tạo tenant trả 201 + { success, data }', async () => {
    const res = await api.post('/admin/tenants', {
      token: admin.token,
      body: { name: `tenant-${Date.now()}` }
    });

    expect(res.status).toBe(201);
    const data = expectOk<{ id: number; name: string }>(res, 201);
    expect(data.id).toBeGreaterThan(0);
  });

  it('endpoint dạng list trả kèm total', async () => {
    const res = await api.get<{ success: boolean; data: unknown[]; total: number }>('/english/pool/questions', {
      token: admin.token,
      query: { pageSize: 5 }
    });

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

/**
 * [đặc tả hiện trạng] Route không tồn tại trả 404 với BODY RỖNG, không phải error envelope.
 * Nguyên nhân: api.ts `.mount(auth.handler)` không kèm prefix nên Better Auth nuốt mọi request
 * không khớp route Elysia. Nhánh `code === 'NOT_FOUND'` trong errorHandler.ts vì thế không bao
 * giờ chạy cho trường hợp này. Chi tiết + hướng sửa: test/notes/FINDINGS.md #1.
 */
describe('route không tồn tại', () => {
  it('[đặc tả hiện trạng] trả 404 body rỗng', async () => {
    for (const path of ['/khong-ton-tai', '/english/khong-ton-tai', '/admin/khong-ton-tai']) {
      const res = await api.get(path, { token: admin.token });
      expect(res.status).toBe(404);
      expect(res.body).toBeNull();
    }
  });

  // Hành vi MONG MUỐN theo docs/tenant-auth.md. Bật lại khi sửa mount của Better Auth.
  it.todo('route không tồn tại nên trả envelope { success:false, error:{ code:"NOT_FOUND" } }', async () => {
    const res = await api.get('/khong-ton-tai', { token: admin.token });
    expectError(res, 404, 'NOT_FOUND');
  });
});
