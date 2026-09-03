import { beforeEach, describe, expect, it } from 'bun:test';
import topicService from '@/core/services/english/topic.service';
import { resetDb } from '../helpers/db.helper';
import { createTopic } from '../helpers/seed.helper';

beforeEach(async () => {
  await resetDb();
});

async function createTopics(count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) ids.push((await createTopic(`topic-${i}`)).id);
  return ids;
}

describe('CRUD + soft delete', () => {
  it('tạo rồi đọc lại được', async () => {
    const created = await topicService.createTopic('daily-life', 'Chủ đề đời thường');
    const found = await topicService.getTopicById(created.id);

    expect(found?.name).toBe('daily-life');
    expect(found?.isActive).toBe(true);
  });

  it('deleteTopic là SOFT delete — row còn nhưng biến khỏi danh sách active', async () => {
    const t = await topicService.createTopic('sap-xoa');

    await topicService.deleteTopic(t.id);

    expect(await topicService.getTopicById(t.id)).not.toBeNull();
    const active = await topicService.getAllActiveTopics();
    expect(active.some((topic) => topic.id === t.id)).toBe(false);
  });

  it('topic đã soft delete không xuất hiện trong random pair', async () => {
    const ids = await createTopics(4);
    await topicService.deleteTopic(ids[0]!);

    for (let i = 0; i < 20; i += 1) {
      const pairs = await topicService.getRandomTopicPairs(2);
      for (const [a, b] of pairs) {
        expect(a.id).not.toBe(ids[0]);
        expect(b.id).not.toBe(ids[0]);
      }
    }
  });
});

describe('getRandomTopicPairs — không lặp topic giữa các cặp', () => {
  it('mỗi topic chỉ xuất hiện tối đa một lần trong toàn bộ kết quả', async () => {
    await createTopics(8);

    for (let run = 0; run < 30; run += 1) {
      const pairs = await topicService.getRandomTopicPairs(3);
      const used = pairs.flatMap(([a, b]) => [a.id, b.id]);
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it('hai vế của một cặp luôn khác nhau', async () => {
    await createTopics(4);

    for (let run = 0; run < 30; run += 1) {
      for (const [a, b] of await topicService.getRandomTopicPairs(2)) {
        expect(a.id).not.toBe(b.id);
      }
    }
  });

  it('không đủ topic để tạo đủ cặp -> trả ít hơn, không crash', async () => {
    await createTopics(3); // chỉ đủ 1 cặp trọn vẹn

    const pairs = await topicService.getRandomTopicPairs(5);

    expect(pairs.length).toBeLessThanOrEqual(1);
  });

  it('ít hơn 2 topic -> mảng rỗng', async () => {
    await createTopics(1);
    expect(await topicService.getRandomTopicPairs(2)).toEqual([]);
  });

  it('không có topic nào -> mảng rỗng', async () => {
    expect(await topicService.getRandomTopicPairs(2)).toEqual([]);
  });

  it('excludeTopicIds loại topic khỏi kết quả khi còn đủ topic khác', async () => {
    const ids = await createTopics(6);
    const excluded = [ids[0]!, ids[1]!];

    for (let run = 0; run < 20; run += 1) {
      const pairs = await topicService.getRandomTopicPairs(2, excluded);
      for (const [a, b] of pairs) {
        expect(excluded).not.toContain(a.id);
        expect(excluded).not.toContain(b.id);
      }
    }
  });

  it('exclude làm cạn pool -> bỏ exclude còn hơn trả rỗng', async () => {
    const ids = await createTopics(3);

    // Loại 2/3 topic -> còn 1, không đủ cặp -> fallback dùng lại toàn bộ pool.
    const pairs = await topicService.getRandomTopicPairs(1, [ids[0]!, ids[1]!]);

    expect(pairs).toHaveLength(1);
  });
});

describe('getRandomTopics', () => {
  it('trả đúng số lượng yêu cầu khi đủ topic', async () => {
    await createTopics(5);
    expect(await topicService.getRandomTopics(3)).toHaveLength(3);
  });

  it('yêu cầu nhiều hơn số topic có -> trả hết, không lặp', async () => {
    await createTopics(3);
    const picked = await topicService.getRandomTopics(10);

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((t) => t.id)).size).toBe(3);
  });

  it('excludeIds được tôn trọng', async () => {
    const ids = await createTopics(4);
    const picked = await topicService.getRandomTopics(10, [ids[0]!]);

    expect(picked.map((t) => t.id)).not.toContain(ids[0]);
  });
});
