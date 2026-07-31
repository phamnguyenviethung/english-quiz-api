import { Elysia } from 'elysia';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import type { TenantContext } from '@/core/services/tenant/tenant.service';
import { ForbiddenException, UnauthorizedException } from '@/core/exceptions';
import { extractAdminKey, isAdminKey } from '@/api/common/adminKey';
import { SCOPES } from '@/api/common/scopes';

/**
 * Context ảo cho request dùng ADMIN_API_KEY: đủ mọi scope, bỏ qua allow-list
 * topic/quizType. Nhờ vậy admin key dùng được ở cả /admin/* lẫn /english/* mà
 * không cần cấp tenant key riêng cho dashboard.
 *
 * `Object.values(SCOPES)` để scope thêm sau này tự động có hiệu lực. id = 0 an
 * toàn vì tenantId không xuống tới tầng data (data quiz là global, xem comment
 * ở src/core/db/schema/main.ts). Constant này không được mutate ở đâu.
 */
const ADMIN_TENANT: TenantContext = {
  id: 0,
  name: '__admin__',
  scopes: Object.values(SCOPES),
  allowAllTopics: true,
  allowedTopicIds: [],
  allowAllQuizTypes: true,
  allowedQuizTypes: [],
  isAdmin: true
};

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
 * - ADMIN_API_KEY được chấp nhận như super key → ADMIN_TENANT (full quyền).
 *
 * Dùng: `.use(tenantAuthPlugin)` ở đầu route module, rồi khai báo
 * `{ auth: { scope: 'quiz:read' } }` cho từng route.
 */
export const tenantAuthPlugin = new Elysia({ name: 'tenant-auth' })
  .resolve(async ({ headers }) => {
    // Check admin key trước: string compare rẻ hơn nhiều so với 3 round-trip DB
    // của verifyKey + getTenantContext. Không khớp thì rơi xuống nhánh tenant.
    const adminRaw = extractAdminKey(headers as Record<string, string | undefined>);
    if (isAdminKey(adminRaw)) return { tenant: ADMIN_TENANT };

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
