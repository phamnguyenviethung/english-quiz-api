import { and, eq } from 'drizzle-orm';
import _ from 'lodash';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { englishTopic, type EnglishTopic, type InsertEnglishTopic } from '@/core/db/schema/main';
import { NotFoundException } from '@/core/exceptions';

async function getAllActiveTopics(): Promise<EnglishTopic[]> {
  return db.select().from(englishTopic).where(eq(englishTopic.isActive, true));
}

async function getTopicById(id: number): Promise<EnglishTopic | null> {
  const [topic] = await db.select().from(englishTopic).where(eq(englishTopic.id, id)).limit(1);
  return topic ?? null;
}

async function getActiveBeginnerTopics(): Promise<EnglishTopic[]> {
  return db
    .select()
    .from(englishTopic)
    .where(and(eq(englishTopic.isActive, true), eq(englishTopic.forBeginner, true)));
}

async function createTopic(name: string, description?: string, forBeginner = false): Promise<EnglishTopic> {
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(englishTopic).values({ name, description, forBeginner }).returning();
    return row;
  });
  if (!created) throw new Error(`[TopicService] Failed to create topic: ${name}`);
  logger.info(`[TopicService] Created topic id=${created.id} name="${name}" forBeginner=${forBeginner}`);
  return created;
}

async function updateTopic(
  id: number,
  data: Partial<Pick<InsertEnglishTopic, 'name' | 'displayName' | 'description' | 'isActive' | 'forBeginner'>>
): Promise<EnglishTopic> {
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(englishTopic)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(englishTopic.id, id))
      .returning();
    return row;
  });
  if (!updated) throw new NotFoundException(`Không tìm thấy topic: ${id}`);
  logger.info(`[TopicService] Updated topic id=${id} fields=${Object.keys(data).join(',')}`);
  return updated;
}

async function deleteTopic(id: number): Promise<void> {
  await updateTopic(id, { isActive: false });
  logger.info(`[TopicService] Soft-deleted topic id=${id}`);
}

async function getRandomTopics(requestCount: number, excludeIds: number[] = []): Promise<EnglishTopic[]> {
  const allActive = await getAllActiveTopics();
  const filtered = excludeIds.length > 0 ? allActive.filter((t) => !excludeIds.includes(t.id)) : allActive;
  return _.sampleSize(filtered, requestCount);
}

function getRandomTopicPairsFromPool(
  basePool: EnglishTopic[],
  pairCount: number,
  excludeTopicIds: number[] = []
): Array<[EnglishTopic, EnglishTopic]> {
  let pool = excludeTopicIds.length > 0 ? basePool.filter((t) => !excludeTopicIds.includes(t.id)) : basePool;

  if (pool.length < 2 && excludeTopicIds.length > 0) {
    logger.warn(`[TopicService] Only ${pool.length} topic(s) after exclusion, falling back to no exclusion`);
    pool = basePool;
  }

  if (pool.length < 2) return [];

  const shuffled = _.shuffle(pool);
  const pairs: Array<[EnglishTopic, EnglishTopic]> = [];
  const usedPairKeys = new Set<string>();
  const usedTopicIds = new Set<number>();

  let attempts = 0;
  const maxAttempts = pairCount * shuffled.length * 2;

  while (pairs.length < pairCount && attempts < maxAttempts) {
    attempts++;
    const available = shuffled.length >= 2 ? shuffled : [...shuffled, ..._.shuffle(pool)];
    const idxA = _.random(0, available.length - 1);
    const topicA = available[idxA]!;
    const rest = available.filter((_, i) => i !== idxA);
    if (rest.length === 0) continue;
    const topicB = rest[_.random(0, rest.length - 1)]!;

    const key = [Math.min(topicA.id, topicB.id), Math.max(topicA.id, topicB.id)].join('_');
    if (usedPairKeys.has(key)) continue;
    if (usedTopicIds.has(topicA.id) || usedTopicIds.has(topicB.id)) continue;

    usedPairKeys.add(key);
    usedTopicIds.add(topicA.id);
    usedTopicIds.add(topicB.id);
    pairs.push([topicA, topicB]);
  }

  return pairs;
}

async function getRandomTopicPairs(
  pairCount: number,
  excludeTopicIds: number[] = []
): Promise<Array<[EnglishTopic, EnglishTopic]>> {
  const allActive = await getAllActiveTopics();
  return getRandomTopicPairsFromPool(allActive, pairCount, excludeTopicIds);
}

export default {
  getAllActiveTopics,
  getActiveBeginnerTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
  getRandomTopics,
  getRandomTopicPairs,
  getRandomTopicPairsFromPool
};
