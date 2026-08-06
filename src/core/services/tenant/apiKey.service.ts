import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { tenantApiKey, type TenantApiKey } from '@/core/db/schema/main';
import { NotFoundException } from '@/core/exceptions';
import tenantService, { type TenantContext } from './tenant.service';

// Key format: eqk_<48 hex random>. Lưu plaintext trong cột `key` (unique) —
// verify bằng lookup trực tiếp. Chưa cần hash.
const KEY_PREFIX = 'eqk';
const KEY_BYTES = 24; // 48 hex chars

// Throttle write lastUsedAt để không ghi DB mỗi request.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

// Record trả ra ngoài (list) — ẩn cột `key` để không lộ key cũ.
export type PublicApiKey = Omit<TenantApiKey, 'key'>;

function generateKey(): string {
  return `${KEY_PREFIX}_${randomBytes(KEY_BYTES).toString('hex')}`;
}

// Cấp key mới cho tenant. Trả plaintext key (đây cũng là giá trị lưu trong DB).
async function issueKey(tenantId: number, label?: string | null): Promise<{ record: TenantApiKey; plaintext: string }> {
  await tenantService.requireTenant(tenantId);
  const key = generateKey();

  const [record] = await db.transaction(async (tx) =>
    tx
      .insert(tenantApiKey)
      .values({ tenantId, key, label: label ?? null })
      .returning()
  );
  if (!record) throw new Error(`[ApiKeyService] Failed to issue key for tenant ${tenantId}`);
  logger.info(`[ApiKeyService] Issued key id=${record.id} tenant=${tenantId}`);
  return { record, plaintext: key };
}

async function listKeys(tenantId: number): Promise<PublicApiKey[]> {
  const rows = await db
    .select()
    .from(tenantApiKey)
    .where(eq(tenantApiKey.tenantId, tenantId))
    .orderBy(desc(tenantApiKey.createdAt));
  // Không trả plaintext key ra ngoài.
  return rows.map(({ key: _key, ...rest }) => rest);
}

// Giới hạn theo tenantId để không thu hồi nhầm key của tenant khác.
async function revokeKey(tenantId: number, apiKeyId: number): Promise<void> {
  const [updated] = await db.transaction(async (tx) =>
    tx
      .update(tenantApiKey)
      .set({ isActive: false, revokedAt: new Date() })
      .where(and(eq(tenantApiKey.id, apiKeyId), eq(tenantApiKey.tenantId, tenantId)))
      .returning()
  );
  if (!updated) {
    throw new NotFoundException(`[ApiKeyService] Không tìm thấy key ${apiKeyId} thuộc tenant ${tenantId}`);
  }
  logger.info(`[ApiKeyService] Revoked key id=${apiKeyId} tenant=${tenantId}`);
}

// Ghi lastUsedAt có throttle — chỉ update nếu quá LAST_USED_THROTTLE_MS.
async function touchLastUsed(record: TenantApiKey): Promise<void> {
  const now = Date.now();
  const last = record.lastUsedAt ? record.lastUsedAt.getTime() : 0;
  if (now - last < LAST_USED_THROTTLE_MS) return;
  try {
    await db.update(tenantApiKey).set({ lastUsedAt: new Date() }).where(eq(tenantApiKey.id, record.id));
  } catch (err) {
    // Không chặn request nếu update lastUsedAt fail.
    logger.warn(`[ApiKeyService] Failed to touch lastUsedAt id=${record.id}: ${err}`);
  }
}

// Verify raw Bearer token → TenantContext, hoặc null nếu không hợp lệ.
async function verifyKey(raw: string): Promise<TenantContext | null> {
  const key = raw.trim();
  if (!key) return null;

  const [record] = await db
    .select()
    .from(tenantApiKey)
    .where(and(eq(tenantApiKey.key, key), eq(tenantApiKey.isActive, true)))
    .limit(1);
  if (!record) return null;

  const context = await tenantService.getTenantContext(record.tenantId);
  if (!context) return null; // tenant bị deactivate

  void touchLastUsed(record);
  return context;
}

export default {
  generateKey,
  issueKey,
  listKeys,
  revokeKey,
  verifyKey
};
