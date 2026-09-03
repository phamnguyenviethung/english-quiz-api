/**
 * Seed script: nhập danh sách AI Models từ MODELS hardcode vào DB, kèm snapshot
 * giá lấy từ OpenRouter catalog (để cost tracking có số liệu ngay).
 * Chạy: bun run src/core/db/seeds/ai-models.seed.ts
 * Script dùng onConflictDoNothing nên có thể chạy nhiều lần an toàn.
 */
import db from '@/configs/orm.config';
import { aiModel, type InsertAiModel } from '@/core/db/schema/main';
import { MODELS } from '@/configs/aiClient.config';
import openrouterCatalogService from '@/core/services/ai/openrouterCatalog.service';
import logger from '@/configs/logger.config';

async function buildSeedRow(key: string, modelId: string): Promise<InsertAiModel> {
  const catalogModel = await openrouterCatalogService.getCatalogModel(modelId);
  if (!catalogModel) {
    logger.warn(`[Seed/AiModels] "${modelId}" không có trên catalog, seed không kèm giá`);
    return { key, modelId, isActive: true };
  }
  return {
    key,
    modelId,
    isActive: true,
    pricePromptPerToken: catalogModel.pricing.prompt,
    priceCompletionPerToken: catalogModel.pricing.completion,
    pricingRaw: { ...catalogModel.pricing },
    openrouterMeta: {
      name: catalogModel.name,
      contextLength: catalogModel.contextLength,
      supportedParameters: catalogModel.supportedParameters,
      topProvider: catalogModel.topProvider
    },
    pricingSyncedAt: new Date()
  };
}

export async function seedAiModels(): Promise<void> {
  const entries = Object.entries(MODELS) as [string, string][];
  logger.info(`[Seed/AiModels] Seeding ${entries.length} models...`);

  const seedData: InsertAiModel[] = [];
  for (const [key, modelId] of entries) {
    seedData.push(await buildSeedRow(key, modelId));
  }

  const inserted = await db.insert(aiModel).values(seedData).onConflictDoNothing().returning();

  logger.info(`[Seed/AiModels] Inserted ${inserted.length} new model(s) (skipped existing).`);
  inserted.forEach((m) =>
    logger.info(`  + id=${m.id} key="${m.key}" modelId="${m.modelId}" priced=${m.pricePromptPerToken !== null}`)
  );
}

// Chỉ tự chạy khi gọi trực tiếp bằng `bun run <file>`. Import từ nơi khác (vd fixture test)
// thì chỉ lấy hàm, không exit process.
if (import.meta.main) {
  seedAiModels()
    .then(() => {
      logger.info('[Seed/AiModels] Done.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('[Seed/AiModels] Failed:', err);
      process.exit(1);
    });
}
