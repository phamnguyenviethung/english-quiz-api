import type { ReadingQuestionTypeModule } from '../module';

export const inferenceModule: ReadingQuestionTypeModule = {
  type: 'inference',
  role: 'You write ONE evidence-based inference question: something the passage does not say outright but clearly supports.',
  evidence: 'at least TWO separate clues in the text that together point to one conclusion',
  method: [
    'Find clue A — a concrete statement in the passage.',
    'Find clue B — a second, separate statement, ideally in a different sentence or paragraph.',
    'Combine them and derive the SMALLEST conclusion they justify. Do not reach further than the two clues carry you.',
    'Confirm the conclusion is genuinely unstated. If the passage says it directly, this is a detail question, not an inference one.',
    'Ask what can be inferred or concluded.'
  ],
  distractors: [
    'A conclusion the passage actively contradicts.',
    'A conclusion supported by only ONE of the clues, so it overreaches.',
    'A conclusion that would need outside knowledge or an assumption the text never licenses.'
  ],
  selfCheck: [
    'Can you name the two specific clues? Write them down for yourself. If you can only find one, drop this question.',
    'Is your conclusion the smallest one the clues support, or did you leap?',
    'Is it truly unstated in the passage?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "inference",
    "question": "What can be concluded about Mai's sewing skill?",
    "options": ["She had sewn many bags before", "She was learning as she went", "She was taught by her mother", "She disliked sewing"],
    "correctAnswer": 1,
    "explanation": "Đoạn 2 nói Mai phải tháo ra khâu lại hai lần và đoạn 3 nói đây là chiếc túi đầu tiên, cho thấy cô vừa làm vừa học."
  }
}`,
  pitfalls: [
    'Building the inference on a single clue — that is speculation, not inference.',
    'Reaching a conclusion that is interesting but bigger than the evidence.',
    'Smuggling in world knowledge the passage does not provide. Infer, do not speculate.'
  ]
};
