/**
 * Seed script: tạo 1 tenant demo + 1 API key để test tenant auth.
 * Chạy: bun --env-file=.env.local run src/core/db/seeds/tenant.seed.ts
 *
 * In plaintext API key ra console ĐÚNG MỘT LẦN — copy ngay để test Bearer.
 * Nếu tenant "demo" đã tồn tại thì bỏ qua tạo tenant, chỉ cấp thêm key mới.
 */
import { eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { tenant } from '@/core/db/schema/main';
import tenantService from '@/core/services/tenant/tenant.service';
import apiKeyService from '@/core/services/tenant/apiKey.service';
import { QUIZ_TYPES } from '@/core/services/english/questionTypes';

const DEMO_NAME = 'demo';

export async function seedTenant(): Promise<void> {
  const [existing] = await db.select().from(tenant).where(eq(tenant.name, DEMO_NAME)).limit(1);

  const demo =
    existing ??
    (await tenantService.createTenant({
      name: DEMO_NAME,
      description: 'Demo tenant cho test tenant auth',
      // Demo được truy cập tất cả topic + quizType cho tiện test.
      allowAllTopics: true,
      allowAllQuizTypes: true
    }));

  logger.info(`[Seed/Tenant] Tenant demo id=${demo.id} (${existing ? 'existing' : 'created'})`);

  // Nếu chưa bật allowAll (tenant cũ), có thể gán allow-list quizType đầy đủ.
  if (existing && !existing.allowAllQuizTypes) {
    await tenantService.setQuizTypeAccess(demo.id, [...QUIZ_TYPES]);
  }

  const { record, plaintext } = await apiKeyService.issueKey(demo.id, 'seed-demo-key');

  logger.info('[Seed/Tenant] ─────────────────────────────────────────────');
  logger.info(`[Seed/Tenant] API key id=${record.id} cho tenant "${DEMO_NAME}":`);
  logger.info(`[Seed/Tenant]   ${plaintext}`);
  logger.info('[Seed/Tenant] LƯU NGAY — plaintext chỉ hiển thị một lần này.');
  logger.info('[Seed/Tenant] Test: curl -H "Authorization: Bearer <key>" localhost:3220/english/quiz-types');
  logger.info('[Seed/Tenant] ─────────────────────────────────────────────');
}

// Chỉ tự chạy khi gọi trực tiếp bằng `bun run <file>`. Import từ nơi khác (vd fixture test)
// thì chỉ lấy hàm, không exit process.
if (import.meta.main) {
  seedTenant()
    .then(() => {
      logger.info('[Seed/Tenant] Done.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('[Seed/Tenant] Failed:', err);
      process.exit(1);
    });
}
