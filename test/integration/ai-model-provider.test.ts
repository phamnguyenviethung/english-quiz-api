import { beforeEach, describe, expect, it } from 'bun:test';
import aiModelService from '@/core/services/ai/aiModel.service';
import db from '@/configs/orm.config';
import { aiModel } from '@/core/db/schema/main';
import { BusinessLogicException } from '@/core/exceptions';
import { resetDb } from '../helpers/db.helper';

/**
 * Provider routing của context schedule/manual (jsonb) phải được validate lúc lưu như context
 * reading, không lưu nguyên giá trị sai rồi để OpenRouter từ chối ở mọi lần sinh câu hỏi.
 */
describe('AI model — validate provider schedule/manual', () => {
  let modelId: number;

  beforeEach(async () => {
    await resetDb();
    const [row] = await db
      .insert(aiModel)
      .values({ key: 'TEST_MODEL', modelId: 'test/provider-model', isActive: true })
      .returning({ id: aiModel.id });
    modelId = row!.id;
  });

  it('tạo model với maxPrice âm -> 400, không tạo row', async () => {
    await expect(
      aiModelService.createModel({
        key: 'BAD',
        modelId: 'test/bad',
        isActive: true,
        scheduleProvider: { maxPrice: { prompt: '-1' } }
      })
    ).rejects.toBeInstanceOf(BusinessLogicException);
    expect(await aiModelService.getModelByModelId('test/bad')).toBeNull();
  });

  it('sửa model với provider trùng lặp -> 400, giữ nguyên giá trị cũ', async () => {
    await aiModelService.updateModel(modelId, { manualProvider: { sort: 'price' } });

    await expect(aiModelService.updateModel(modelId, { manualProvider: { only: ['a', 'a'] } })).rejects.toBeInstanceOf(
      BusinessLogicException
    );
    expect((await aiModelService.getModelById(modelId))!.manualProvider).toEqual({ sort: 'price' });
  });

  it('giá trị hợp lệ được lưu ở dạng chuẩn; object rỗng lưu thành null', async () => {
    const updated = await aiModelService.updateModel(modelId, {
      scheduleProvider: { order: [' openai ', ''], maxPrice: { completion: '2.0' } },
      manualProvider: {}
    });

    expect(updated.scheduleProvider).toEqual({ order: ['openai'], maxPrice: { completion: '2' } });
    expect(updated.manualProvider).toBeNull();
  });

  it('không gửi provider thì giữ nguyên', async () => {
    await aiModelService.updateModel(modelId, { scheduleProvider: { sort: 'throughput' } });

    const updated = await aiModelService.updateModel(modelId, { isActive: false });

    expect(updated.scheduleProvider).toEqual({ sort: 'throughput' });
  });
});
