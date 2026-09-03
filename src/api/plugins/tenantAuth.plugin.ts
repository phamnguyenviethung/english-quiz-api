import { Elysia } from 'elysia';
import apiKeyService, { API_KEY_PREFIX } from '@/core/services/tenant/apiKey.service';
import type { TenantContext } from '@/core/services/tenant/tenant.service';
import { ForbiddenException, UnauthorizedException } from '@/core/exceptions';
import { getAdminUser } from '@/api/plugins/adminAuth.plugin';

/**
 * Context ảo cho request của tài khoản admin (Better Auth): bỏ qua allow-list
 * topic/quizType và vượt qua guard admin-only. Nhờ vậy admin đăng nhập một lần là
 * dùng được cả /admin/* lẫn /english/* mà không cần cấp tenant key riêng cho dashboard.
 *
 * id = 0 an toàn vì tenantId không xuống tới tầng data (data quiz là global,
 * xem comment ở src/core/db/schema/main.ts). Constant này không được mutate ở đâu.
 */
export const ADMIN_TENANT: TenantContext = {
  id: 0,
  name: '__admin__',
  allowAllTopics: true,
  allowedTopicIds: [],
  allowAllQuizTypes: true,
  allowedQuizTypes: [],
  isAdmin: true
};

// Đọc raw Bearer token từ header Authorization.
export function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

// Tenant key chỉ được đọc quiz. Endpoint quản trị nằm dưới /english/* (nạp
// pool, sửa config, tạo topic, xem cron) chỉ chấp nhận tài khoản admin.
function assertAdmin(tenant: TenantContext): void {
  if (!tenant.isAdmin) {
    throw new ForbiddenException('Endpoint này chỉ dành cho tài khoản admin');
  }
}

/**
 * Plugin xác thực cho /english/*: tenant API key Bearer **hoặc** session admin.
 *
 * - `.resolve` inject `tenant: TenantContext` vào mọi request dùng plugin này.
 * - macro `auth` nhận `{ admin }` để giới hạn route cho tài khoản admin.
 * - Session admin được chấp nhận như super key → ADMIN_TENANT (full quyền).
 *
 * Dùng: `.use(tenantAuthPlugin)` ở đầu route module, rồi khai báo `{ auth: true }`
 * (mọi tenant key hợp lệ) hoặc `{ auth: { admin: true } }` (chỉ admin) cho từng route.
 */
export const tenantAuthPlugin = new Elysia({ name: 'tenant-auth' })
  .resolve(async ({ headers, request }) => {
    // `Authorization: Bearer` giờ mang 2 loại token: tenant key (`eqk_...`) và session
    // token của Better Auth. Phân biệt bằng prefix để traffic bot không phải trả thêm
    // một lượt query session mỗi request.
    const raw = extractBearer(headers.authorization);

    if (raw?.startsWith(API_KEY_PREFIX)) {
      const tenant = await apiKeyService.verifyKey(raw);
      if (!tenant) throw new UnauthorizedException('API key không hợp lệ hoặc đã bị thu hồi');
      return { tenant };
    }

    // Không phải tenant key → thử session Better Auth (bearer token hoặc cookie).
    const adminUser = await getAdminUser(request.headers);
    if (adminUser) return { tenant: ADMIN_TENANT };

    throw new UnauthorizedException('Thiếu tenant API key hợp lệ hoặc phiên đăng nhập admin');
  })
  .macro({
    auth: (config: { admin?: boolean } | boolean) => ({
      beforeHandle(ctx: { tenant?: TenantContext }) {
        if (config === false) return;
        // `.resolve` chạy trước và luôn set tenant (hoặc throw 401), nên tại đây
        // tenant chắc chắn có; guard undefined để thoả type.
        if (!ctx.tenant) throw new UnauthorizedException('Chưa xác thực tenant');
        if (typeof config === 'object' && config.admin) assertAdmin(ctx.tenant);
      }
    })
  })
  .as('scoped');

// Helper dùng trong handler để chặn truy cập topic/quizType ngoài allow-list.

// topicId === null (bucket no-topic) luôn được phép.
export function assertTopicAllowed(tenant: TenantContext, topicId: number | null): void {
  if (topicId === null) return;
  if (tenant.allowAllTopics) return;
  if (!tenant.allowedTopicIds.includes(topicId)) {
    throw new ForbiddenException(`Tenant không có quyền truy cập topic ${topicId}`);
  }
}

export function assertQuizTypeAllowed(tenant: TenantContext, quizType: string): void {
  if (tenant.allowAllQuizTypes) return;
  if (!tenant.allowedQuizTypes.includes(quizType)) {
    throw new ForbiddenException(`Tenant không có quyền truy cập quizType "${quizType}"`);
  }
}
