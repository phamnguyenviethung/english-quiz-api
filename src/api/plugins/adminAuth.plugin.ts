import { Elysia } from 'elysia';
import { UnauthorizedException } from '@/core/exceptions';
import { extractAdminKey, isAdminKey } from '@/api/common/adminKey';

/**
 * Guard cho các route quản trị (/admin/*). So sánh secret gửi lên với
 * ADMIN_API_KEY trong env. ADMIN_API_KEY được checkEnv lúc boot
 * (src/index.ts) nên chắc chắn tồn tại.
 *
 * Chiều ngược lại: admin key cũng dùng được ở /english/* như super key —
 * xem tenantAuth.plugin.ts.
 */
export const adminAuthPlugin = new Elysia({ name: 'admin-auth' })
  .onBeforeHandle(({ headers }) => {
    if (!process.env.ADMIN_API_KEY) throw new UnauthorizedException('ADMIN_API_KEY chưa được cấu hình');

    const provided = extractAdminKey(headers as Record<string, string | undefined>);
    if (!isAdminKey(provided)) {
      throw new UnauthorizedException('Admin key không hợp lệ');
    }
  })
  .as('scoped');
