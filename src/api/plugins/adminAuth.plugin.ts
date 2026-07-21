import { Elysia } from 'elysia';
import { UnauthorizedException } from '@/core/exceptions';

// Đọc admin secret từ header 'x-admin-key' hoặc 'Authorization: Bearer'.
function extractAdminKey(headers: Record<string, string | undefined>): string | null {
  const headerKey = headers['x-admin-key'];
  if (headerKey) return headerKey;
  const auth = headers.authorization;
  if (auth) {
    const [scheme, token] = auth.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  return null;
}

/**
 * Guard cho các route quản trị (/admin/*). So sánh secret gửi lên với
 * ADMIN_API_KEY trong env. ADMIN_API_KEY được checkEnv lúc boot
 * (src/index.ts) nên chắc chắn tồn tại.
 */
export const adminAuthPlugin = new Elysia({ name: 'admin-auth' })
  .onBeforeHandle(({ headers }) => {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) throw new UnauthorizedException('ADMIN_API_KEY chưa được cấu hình');

    const provided = extractAdminKey(headers as Record<string, string | undefined>);
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Admin key không hợp lệ');
    }
  })
  .as('scoped');
