import { asc, eq, inArray } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import {
  englishTopic,
  tenant,
  tenantQuizTypeAccess,
  tenantTopicAccess,
  type InsertTenant,
  type Tenant
} from '@/core/db/schema/main';
import { BusinessLogicException, ConflictException, NotFoundException } from '@/core/exceptions';
import { isQuizType, type QuizType } from '@/core/services/english/questionTypes';

// Snapshot quyền của 1 tenant, dùng bởi auth plugin để inject vào request context.
export interface TenantContext {
  id: number;
  name: string;
  allowAllTopics: boolean;
  allowedTopicIds: number[];
  allowAllQuizTypes: boolean;
  allowedQuizTypes: string[];
  // true khi request dùng ADMIN_API_KEY (context ảo, không ứng với tenant row nào).
  isAdmin?: boolean;
}

interface CreateTenantInput {
  name: string;
  description?: string | null;
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
}

// Map Postgres unique-constraint (23505) sang lỗi domain (theo pattern
// aiModel.service.ts). Chỉ có unique trên tenants.name.
function toConflictError(err: unknown): ConflictException | null {
  if (!(err instanceof Error)) return null;
  const code =
    'code' in err && typeof err.code === 'string'
      ? err.code
      : 'cause' in err && err.cause && typeof err.cause === 'object' && 'code' in err.cause
        ? String((err.cause as { code?: unknown }).code)
        : null;
  if (code !== '23505') return null;
  return new ConflictException('[TenantService] Tenant name đã tồn tại');
}

async function getAllTenants(): Promise<Tenant[]> {
  return db.select().from(tenant).orderBy(asc(tenant.id));
}

async function getTenantById(id: number): Promise<Tenant | null> {
  const [row] = await db.select().from(tenant).where(eq(tenant.id, id)).limit(1);
  return row ?? null;
}

async function requireTenant(id: number): Promise<Tenant> {
  const found = await getTenantById(id);
  if (!found) throw new NotFoundException(`[TenantService] Không tìm thấy tenant: ${id}`);
  return found;
}

async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  try {
    const [created] = await db.transaction(async (tx) =>
      tx
        .insert(tenant)
        .values({
          name: input.name,
          description: input.description ?? null,
          allowAllTopics: input.allowAllTopics ?? false,
          allowAllQuizTypes: input.allowAllQuizTypes ?? false
        })
        .returning()
    );
    if (!created) throw new Error(`[TenantService] Failed to create tenant: ${input.name}`);
    logger.info(`[TenantService] Created tenant id=${created.id} name="${created.name}"`);
    return created;
  } catch (err) {
    const conflict = toConflictError(err);
    if (conflict) throw conflict;
    throw err;
  }
}

async function updateTenant(
  id: number,
  data: Partial<Pick<InsertTenant, 'name' | 'description' | 'allowAllTopics' | 'allowAllQuizTypes' | 'isActive'>>
): Promise<Tenant> {
  try {
    const [updated] = await db.transaction(async (tx) =>
      tx
        .update(tenant)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(tenant.id, id))
        .returning()
    );
    if (!updated) throw new NotFoundException(`[TenantService] Không tìm thấy tenant: ${id}`);
    logger.info(`[TenantService] Updated tenant id=${id}`);
    return updated;
  } catch (err) {
    const conflict = toConflictError(err);
    if (conflict) throw conflict;
    throw err;
  }
}

async function deactivateTenant(id: number): Promise<Tenant> {
  return updateTenant(id, { isActive: false });
}

// Replace toàn bộ allow-list topic của tenant trong 1 transaction. Validate
// topicId tồn tại trước khi insert.
async function setTopicAccess(tenantId: number, topicIds: number[]): Promise<number[]> {
  await requireTenant(tenantId);
  const uniqueIds = [...new Set(topicIds)];

  if (uniqueIds.length > 0) {
    const existing = await db
      .select({ id: englishTopic.id })
      .from(englishTopic)
      .where(inArray(englishTopic.id, uniqueIds));
    const existingIds = new Set(existing.map((t) => t.id));
    const missing = uniqueIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new BusinessLogicException(`[TenantService] Topic không tồn tại: ${missing.join(', ')}`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(tenantTopicAccess).where(eq(tenantTopicAccess.tenantId, tenantId));
    if (uniqueIds.length > 0) {
      await tx.insert(tenantTopicAccess).values(uniqueIds.map((topicId) => ({ tenantId, topicId })));
    }
  });
  logger.info(`[TenantService] Set topic access tenant=${tenantId} count=${uniqueIds.length}`);
  return uniqueIds;
}

// Replace toàn bộ allow-list quizType của tenant. Validate bằng isQuizType.
async function setQuizTypeAccess(tenantId: number, quizTypes: string[]): Promise<QuizType[]> {
  await requireTenant(tenantId);
  const uniqueTypes = [...new Set(quizTypes)];
  const invalid = uniqueTypes.filter((q) => !isQuizType(q));
  if (invalid.length > 0) {
    throw new BusinessLogicException(`[TenantService] quizType không hợp lệ: ${invalid.join(', ')}`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(tenantQuizTypeAccess).where(eq(tenantQuizTypeAccess.tenantId, tenantId));
    if (uniqueTypes.length > 0) {
      await tx.insert(tenantQuizTypeAccess).values(uniqueTypes.map((quizType) => ({ tenantId, quizType })));
    }
  });
  logger.info(`[TenantService] Set quizType access tenant=${tenantId} count=${uniqueTypes.length}`);
  return uniqueTypes as QuizType[];
}

async function getAllowedTopicIds(tenantId: number): Promise<number[]> {
  const rows = await db
    .select({ topicId: tenantTopicAccess.topicId })
    .from(tenantTopicAccess)
    .where(eq(tenantTopicAccess.tenantId, tenantId));
  return rows.map((r) => r.topicId);
}

async function getAllowedQuizTypes(tenantId: number): Promise<string[]> {
  const rows = await db
    .select({ quizType: tenantQuizTypeAccess.quizType })
    .from(tenantQuizTypeAccess)
    .where(eq(tenantQuizTypeAccess.tenantId, tenantId));
  return rows.map((r) => r.quizType);
}

// Gộp tenant + allow-list thành TenantContext. Chỉ trả về nếu tenant active.
async function getTenantContext(tenantId: number): Promise<TenantContext | null> {
  const found = await getTenantById(tenantId);
  if (!found || !found.isActive) return null;

  const [allowedTopicIds, allowedQuizTypes] = await Promise.all([
    getAllowedTopicIds(tenantId),
    getAllowedQuizTypes(tenantId)
  ]);

  return {
    id: found.id,
    name: found.name,
    allowAllTopics: found.allowAllTopics,
    allowedTopicIds,
    allowAllQuizTypes: found.allowAllQuizTypes,
    allowedQuizTypes
  };
}

export default {
  getAllTenants,
  getTenantById,
  requireTenant,
  createTenant,
  updateTenant,
  deactivateTenant,
  setTopicAccess,
  setQuizTypeAccess,
  getAllowedTopicIds,
  getAllowedQuizTypes,
  getTenantContext
};
