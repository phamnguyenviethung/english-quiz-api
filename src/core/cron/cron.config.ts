import type { ConnectionOptions } from 'bullmq';

export const TIMEZONE = 'Asia/Ho_Chi_Minh';

const redisUrl = new URL(process.env.REDIS_URL!);

export const bullmqConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};
