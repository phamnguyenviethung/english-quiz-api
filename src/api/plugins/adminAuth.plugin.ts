import { Elysia } from 'elysia';
import { ForbiddenException, UnauthorizedException } from '@/core/exceptions';
import { auth, Role, type AuthUser } from '@/configs/auth.config';

/**
 * Guard cho các route quản trị (/admin/*): yêu cầu **session Better Auth có role
 * `admin`**. Thay cho ADMIN_API_KEY (secret tĩnh) trước đây.
 *
 * `auth.api.getSession` đọc được cả cookie lẫn `Authorization: Bearer <session token>`
 * (plugin `bearer` convert bearer → cookie ở hook before), nên một guard phục vụ
 * được cả dashboard (bearer) lẫn browser UI (cookie).
 *
 * Chiều ngược lại: session admin cũng dùng được ở /english/* như super key —
 * xem tenantAuth.plugin.ts.
 */
export async function resolveAdminUser(headers: Headers): Promise<AuthUser> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new UnauthorizedException('Chưa đăng nhập');
  if (session.user.banned) throw new ForbiddenException('Tài khoản đã bị khoá');
  if (session.user.role !== Role.ADMIN) throw new ForbiddenException('Tài khoản không có quyền admin');
  return session.user;
}

// Trả về null thay vì throw — dùng cho chỗ cần fallback sang cơ chế auth khác
// (tenantAuth.plugin.ts) hoặc chỉ cần biết có phải admin hay không.
export async function getAdminUser(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session || session.user.banned) return null;
  return session.user.role === Role.ADMIN ? session.user : null;
}

export const adminAuthPlugin = new Elysia({ name: 'admin-auth' })
  .resolve(async ({ request }) => ({ user: await resolveAdminUser(request.headers) }))
  .as('scoped');
