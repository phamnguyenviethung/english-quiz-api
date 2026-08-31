import logger from '@/configs/logger.config';
import questionGenJob from './question-gen.job';
import poolRefillJob from './pool-refill.job';
import siblingGenJob from './sibling-gen.job';
import readingGenJob from './reading-gen.job';
import readingQuestionGenJob from './reading-question-gen.job';
import englishCronJobTrackingService from '@/core/services/english/englishCronJobTracking.service';

const STALE_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 giờ

export default async function initCronJobs(): Promise<void> {
  logger.info('⏰ Starting cron jobs initialization...');

  // Cleanup runs bị stuck "running" từ session trước (process crash, OOM, ...)
  await englishCronJobTrackingService.markStaleRunsFailed(STALE_RUN_THRESHOLD_MS);

  await questionGenJob();
  await poolRefillJob();
  await siblingGenJob();
  await readingGenJob();
  await readingQuestionGenJob();

  logger.info('✅ All cron jobs registered and started');
}

export async function shutdownCronJobs(): Promise<void> {
  logger.info('[Cron] Shutting down all queues and workers...');

  // Dynamic imports after init to get the populated module-level vars
  const [questionGen, poolRefill, siblingGen, readingGen, readingQuestionGen] = await Promise.all([
    import('./question-gen.job'),
    import('./pool-refill.job'),
    import('./sibling-gen.job'),
    import('./reading-gen.job'),
    import('./reading-question-gen.job')
  ]);

  await Promise.allSettled([
    questionGen.questionGenWorker?.close(),
    poolRefill.poolRefillParentWorker?.close(),
    poolRefill.poolRefillChildWorker?.close(),
    poolRefill.poolRefillFlowProducer?.close(),
    siblingGen.siblingGenWorker?.close(),
    siblingGen.siblingGenQueue?.close(),
    readingGen.readingRefillParentWorker?.close(),
    readingGen.readingRefillChildWorker?.close(),
    readingGen.readingRefillFlowProducer?.close(),
    readingQuestionGen.readingQuestionRefillParentWorker?.close(),
    readingQuestionGen.readingQuestionRefillChildWorker?.close(),
    readingQuestionGen.readingQuestionRefillFlowProducer?.close(),
    questionGen.questionGenQueue?.close(),
    poolRefill.poolRefillQueue?.close(),
    poolRefill.poolRefillChildQueue?.close(),
    readingGen.readingRefillQueue?.close(),
    readingGen.readingRefillChildQueue?.close(),
    readingQuestionGen.readingQuestionRefillQueue?.close(),
    readingQuestionGen.readingQuestionRefillChildQueue?.close()
  ]);

  logger.info('[Cron] All queues and workers closed');
}
