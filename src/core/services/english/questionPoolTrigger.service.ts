import poolRefillService from './poolRefill.service';
import type { DifficultyContext } from './study.service';
import type { QuizType } from './questionTypes';

// Thin wrapper — giữ tên public ổn định cho english.controller.ts. Logic thật
// nằm ở poolRefill.service.ts (runOnDemandRefill), dùng chung engine với
// scheduled/manual refill.
async function ensurePoolFilled(
  engLevel: DifficultyContext['engLevel'],
  topicId: number | null,
  topicName: string | null,
  quizType: QuizType,
  optionCount: 4 | 5
): Promise<void> {
  await poolRefillService.runOnDemandRefill({ engLevel, topicId, topicName, quizType, optionCount });
}

export default {
  ensurePoolFilled
};
