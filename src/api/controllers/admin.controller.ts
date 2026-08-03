import logger from '@/configs/logger.config';
import { NotFoundException } from '@/core/exceptions';
import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import poolRefillService from '@/core/services/english/poolRefill.service';
import { MODELS } from '@/configs/aiClient.config';

// ─── Tenants ────────────────────────────────────────────────────────────────────

function listTenants() {
  return tenantService.getAllTenants();
}

async function getTenant(id: number) {
  const found = await tenantService.getTenantById(id);
  if (!found) throw new NotFoundException(`Không tìm thấy tenant: ${id}`);
  return found;
}

interface CreateTenantInput {
  name: string;
  description?: string | null;
  scopes?: string[];
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
}

function createTenant(input: CreateTenantInput) {
  logger.info(`[Admin] Create tenant name="${input.name}"`);
  return tenantService.createTenant(input);
}

interface UpdateTenantInput {
  name?: string;
  description?: string | null;
  scopes?: string[];
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
  isActive?: boolean;
}

function updateTenant(id: number, input: UpdateTenantInput) {
  return tenantService.updateTenant(id, input);
}

// ─── API keys ────────────────────────────────────────────────────────────────────

async function issueKey(tenantId: number, label: string | null) {
  const { record, plaintext } = await apiKeyService.issueKey(tenantId, label);
  // Plaintext CHỈ trả về đúng một lần ở đây — client phải lưu ngay.
  return {
    id: record.id,
    label: record.label,
    apiKey: plaintext,
    warning: 'Lưu apiKey ngay — giá trị đầy đủ chỉ hiển thị một lần này.'
  };
}

function listKeys(tenantId: number) {
  return apiKeyService.listKeys(tenantId);
}

async function revokeKey(tenantId: number, apiKeyId: number) {
  await apiKeyService.revokeKey(tenantId, apiKeyId);
  return { apiKeyId, revoked: true };
}

// ─── Grants (allow-list) ──────────────────────────────────────────────────────────

async function getTopicAccess(tenantId: number) {
  await tenantService.requireTenant(tenantId);
  return { tenantId, topicIds: await tenantService.getAllowedTopicIds(tenantId) };
}

async function getQuizTypeAccess(tenantId: number) {
  await tenantService.requireTenant(tenantId);
  return { tenantId, quizTypes: await tenantService.getAllowedQuizTypes(tenantId) };
}

async function setTopicAccess(tenantId: number, topicIds: number[]) {
  const applied = await tenantService.setTopicAccess(tenantId, topicIds);
  return { tenantId, topicIds: applied };
}

async function setQuizTypeAccess(tenantId: number, quizTypes: string[]) {
  const applied = await tenantService.setQuizTypeAccess(tenantId, quizTypes);
  return { tenantId, quizTypes: applied };
}

// ─── Pool ───────────────────────────────────────────────────────────────────────

interface TriggerManualPoolRefillInput {
  model?: string;
  countPerBucket?: number;
  scope?: 'all' | 'deficient';
}

async function triggerManualPoolRefill(input: TriggerManualPoolRefillInput) {
  const model = input.model ?? MODELS.GEMINI_FLASH_LITE;
  logger.info(
    `[Admin] Manual pool refill scope=${input.scope ?? 'all'} model=${model} countPerBucket=${input.countPerBucket ?? '-'}`
  );
  return poolRefillService.runManualRefill({ model, countPerBucket: input.countPerBucket, scope: input.scope });
}

export default {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  issueKey,
  listKeys,
  revokeKey,
  getTopicAccess,
  getQuizTypeAccess,
  setTopicAccess,
  setQuizTypeAccess,
  triggerManualPoolRefill
};
