import logger from '@/configs/logger.config';
import questionPoolService, { getRefillThreshold, getMaxPoolSize } from './questionPool.service';
import { getQuestionGenQueue } from '@/core/cron/question-gen.job';
import { getEnglishConfigSnapshot } from './englishConfig.service';
import type { DifficultyContext } from './study.service';
import type { QuizType } from './questionTypes';

async function ensurePoolFilled(
  engLevel: DifficultyContext['engLevel'],
  topicId: number | null,
  topicName: string | null,
  quizType: QuizType,
  optionCount: 4 | 5
): Promise<void> {
  try {
    if (!getEnglishConfigSnapshot().job_flags.questionGenEnabled) {
      logger.info('[QuestionPoolTrigger] Question-gen disabled, skip refill enqueue');
      return;
    }

    const currentCount = await questionPoolService.getPoolCount(engLevel, quizType, topicId);
    const threshold = getRefillThreshold();

    if (currentCount >= threshold) return;

    const needed = getMaxPoolSize() - currentCount;

    logger.info(
      `[QuestionPoolTrigger] Pool low (${currentCount}/${threshold}) for engLevel=${engLevel} topicId=${topicId} quizType=${quizType}, adding refill job count=${needed}`
    );

    const jobId = `refill_${engLevel}_${topicId ?? 'null'}_${quizType}`;
    await getQuestionGenQueue().add(
      jobId,
      { engLevel, quizType, optionCount, topicId, topicName, count: needed },
      { jobId }
    );
  } catch (err) {
    logger.warn(
      `[QuestionPoolTrigger] Failed to trigger refill for engLevel=${engLevel} topicId=${topicId} quizType=${quizType}: ${err}`
    );
  }
}

export default {
  ensurePoolFilled
};
