import { Elysia } from 'elysia';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import type { TenantContext } from '@/core/services/tenant/tenant.service';
import { ForbiddenException, UnauthorizedException } from '@/core/exceptions';

// Đọc raw Bearer token từ header Authorization.
function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

// Kiểm tra tenant có scope yêu cầu không. Không có scope nào yêu cầu → chỉ cần
// xác thực hợp lệ.
function assertScopes(tenant: TenantContext, required: string | string[] | undefined): void {
  if (!required) return;
  const requiredList = Array.isArray(required) ? required : [required];
  const missing = requiredList.filter((s) => !tenant.scopes.includes(s));
  if (missing.length > 0) {
    throw new ForbiddenException(`Thiếu scope: ${missing.join(', ')}`);
  }
}

/**
 * Plugin xác thực tenant qua API key Bearer.
 *
 * - `.resolve` inject `tenant: TenantContext` vào mọi request dùng plugin này.
 * - macro `auth` nhận `{ scope }` để guard theo capability trên từng route.
 *
 * Dùng: `.use(tenantAuthPlugin)` ở đầu route module, rồi khai báo
 * `{ auth: { scope: 'quiz:read' } }` cho từng route.
 */
export const tenantAuthPlugin = new Elysia({ name: 'tenant-auth' })
  .resolve(async ({ headers }) => {
    const raw = extractBearer(headers.authorization);
    if (!raw) throw new UnauthorizedException('Thiếu Bearer API key');

    const tenant = await apiKeyService.verifyKey(raw);
    if (!tenant) throw new UnauthorizedException('API key không hợp lệ hoặc đã bị thu hồi');

    return { tenant };
  })
  .macro({
    auth: (config: { scope?: string | string[] } | boolean) => ({
      beforeHandle(ctx: { tenant?: TenantContext }) {
        if (config === false) return;
        // `.resolve` chạy trước và luôn set tenant (hoặc throw 401), nên tại đây
        // tenant chắc chắn có; guard undefined để thoả type.
        if (!ctx.tenant) throw new UnauthorizedException('Chưa xác thực tenant');
        const scope = typeof config === 'object' ? config.scope : undefined;
        assertScopes(ctx.tenant, scope);
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
