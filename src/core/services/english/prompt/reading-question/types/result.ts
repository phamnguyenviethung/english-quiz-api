import type { ReadingQuestionTypeModule } from '../module';

export const resultModule: ReadingQuestionTypeModule = {
  type: 'result',
  role: 'You write ONE outcome question: what actually happened in the end.',
  evidence: 'a situation → problem → action → outcome chain, with the final outcome stated',
  method: [
    'Identify the situation or problem the passage opens with.',
    'Follow the actions the character takes.',
    'Find the ACTUAL final outcome, the one the passage settles on.',
    'Ask what happened in the end, or what X eventually did.',
    'Write the correct option as that final outcome.'
  ],
  distractors: [
    'An earlier action in the chain, before the final outcome.',
    'Something the character INTENDED or planned but did not end up doing.',
    'An outcome that would be reasonable but that the passage never reaches.'
  ],
  selfCheck: [
    'Is your correct option the actual result, not a plan or an intention?',
    'Is the outcome the final state of the story, not a middle step?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "result",
    "question": "What happened to the bag in the end?",
    "options": ["Mai sold it at the market", "Mai gave it to her sister", "Mai used it every day", "Mai put it away in a box"],
    "correctAnswer": 2,
    "explanation": "Đoạn 3 kết lại rằng Mai dùng chiếc túi mỗi ngày."
  }
}`,
  pitfalls: [
    'Picking an intermediate action as the answer.',
    'Treating a stated plan as the outcome.',
    'Asking about an outcome the passage leaves open — if the story does not resolve, this type does not fit.'
  ]
};
