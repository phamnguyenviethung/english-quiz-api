/**
 * Seed script: nhập danh sách AI Models từ MODELS hardcode vào DB.
 * Chạy: bun run src/core/db/seeds/ai-models.seed.ts
 * Script dùng onConflictDoNothing nên có thể chạy nhiều lần an toàn.
 */
import db from '@/configs/orm.config';
import { aiModel } from '@/core/db/schema/main';
import { MODELS } from '@/configs/aiClient.config';
import logger from '@/configs/logger.config';

const SEED_DATA = (Object.entries(MODELS) as [string, string][]).map(([key, modelId]) => ({
  key,
  modelId,
  isActive: true
}));

async function seedAiModels(): Promise<void> {
  logger.info(`[Seed/AiModels] Seeding ${SEED_DATA.length} models...`);

  const inserted = await db.insert(aiModel).values(SEED_DATA).onConflictDoNothing().returning();

  logger.info(`[Seed/AiModels] Inserted ${inserted.length} new model(s) (skipped existing).`);
  inserted.forEach((m) => logger.info(`  + id=${m.id} key="${m.key}" modelId="${m.modelId}"`));
}

seedAiModels()
  .then(() => {
    logger.info('[Seed/AiModels] Done.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('[Seed/AiModels] Failed:', err);
    process.exit(1);
  });
