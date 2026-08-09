import logger from '@/configs/logger.config';
import redisClient from '@/configs/redis.config';
import checkEnv from '@/utils/checkEnv';
import { ensureEnglishConfigSeeded } from '@/core/services/english/englishConfig.service';
import startCron, { shutdownCronJobs } from '@/core/cron';
import { startApi } from '@/api/api';

logger.info(`ENV: ${process.env.NODE_ENV}`);

async function shutdown(): Promise<void> {
  logger.info('[App] Graceful shutdown initiated...');
  await shutdownCronJobs();
  await redisClient.quit();
  logger.info('[App] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const start = async (): Promise<void> => {
  try {
    // 0. Validate env bắt buộc (fail fast nếu thiếu secret của Better Auth — không có
    //    nó thì mọi route /admin/* và /english/* admin-only đều không đăng nhập được)
    checkEnv(['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']);
    // 1. Seed + load config snapshot vào memory (mọi service đọc snapshot đồng bộ)
    await ensureEnglishConfigSeeded();
    // 2. Init BullMQ english jobs (question-gen, pool-refill, manual-fill)
    await startCron();
    // 3. Start HTTP API
    await startApi();
  } catch (error) {
    logger.error(`Error starting english-quiz-api: ${error}`);
    process.exit(1);
  }
};

start();
