import { eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import { auth, Role } from '@/configs/auth.config';
import { users } from '@/core/db/schema/auth';

/**
 * Tạo user + lấy session token qua `auth.api` (không qua app.handle).
 *
 * Cố ý đi thẳng auth.api: Better Auth bật rateLimit 30 req/60s trên đường HTTP, e2e đăng
 * nhập nhiều lần sẽ dính 429 và làm test flaky vì lý do không liên quan nghiệp vụ.
 */

const DEFAULT_PASSWORD = 'test-password-123456';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Dùng làm `Authorization: Bearer <token>`. */
  token: string;
}

let counter = 0;

function nextEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@test.local`;
}

async function signUpAndSignIn(email: string, name: string): Promise<{ id: string; token: string }> {
  await auth.api.signUpEmail({ body: { email, password: DEFAULT_PASSWORD, name } });

  // Plugin `bearer` trả session token ở header `set-auth-token`.
  const response = await auth.api.signInEmail({
    body: { email, password: DEFAULT_PASSWORD },
    asResponse: true
  });
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error(`[test/auth] Không lấy được set-auth-token cho ${email}`);

  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`[test/auth] Không tìm thấy user vừa tạo ${email}`);
  return { id: row.id, token };
}

/** User role='admin' — qua được cả /admin/* lẫn mọi endpoint admin-only của /english/*. */
export async function createAdminUser(): Promise<TestUser> {
  const email = nextEmail('admin');
  const { id } = await signUpAndSignIn(email, 'Test Admin');

  await db.transaction(async (tx) => {
    await tx.update(users).set({ role: Role.ADMIN }).where(eq(users.id, id));
  });

  // Đăng nhập lại sau khi promote để session mang role mới.
  const response = await auth.api.signInEmail({
    body: { email, password: DEFAULT_PASSWORD },
    asResponse: true
  });
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error(`[test/auth] Không lấy được token admin cho ${email}`);

  return { id, email, password: DEFAULT_PASSWORD, token };
}

/** User role='user' (mặc định khi signup) — không có quyền gì. */
export async function createNormalUser(): Promise<TestUser> {
  const email = nextEmail('user');
  const { id, token } = await signUpAndSignIn(email, 'Test User');
  return { id, email, password: DEFAULT_PASSWORD, token };
}

export async function banUser(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ banned: true, banReason: 'test' }).where(eq(users.id, userId));
  });
}
