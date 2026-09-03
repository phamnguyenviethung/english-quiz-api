import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import type { Tenant } from '@/core/db/schema/main';

export interface TestTenant {
  tenant: Tenant;
  /** Plaintext `eqk_...` — chỉ lấy được đúng lúc issue, giống thực tế. */
  apiKey: string;
  apiKeyId: number;
}

let counter = 0;

export interface CreateTestTenantInput {
  name?: string;
  allowAllTopics?: boolean;
  allowAllQuizTypes?: boolean;
  /** Allow-list topic. Bỏ trống + allowAllTopics=false => tenant không thấy topic nào. */
  topicIds?: number[];
  quizTypes?: string[];
}

export async function createTestTenant(input: CreateTestTenantInput = {}): Promise<TestTenant> {
  counter += 1;
  const tenant = await tenantService.createTenant({
    name: input.name ?? `tenant-${Date.now()}-${counter}`,
    allowAllTopics: input.allowAllTopics ?? false,
    allowAllQuizTypes: input.allowAllQuizTypes ?? false
  });

  if (input.topicIds?.length) await tenantService.setTopicAccess(tenant.id, input.topicIds);
  if (input.quizTypes?.length) await tenantService.setQuizTypeAccess(tenant.id, input.quizTypes);

  const { record, plaintext } = await apiKeyService.issueKey(tenant.id, 'test-key');
  return { tenant, apiKey: plaintext, apiKeyId: record.id };
}
