import type { ReadingQuestionTypeModule } from '../module';

export const purposeModule: ReadingQuestionTypeModule = {
  type: 'purpose',
  role: 'You write ONE intent question: what someone was trying to achieve.',
  evidence: 'an action together with the goal the actor had in mind',
  method: [
    'Identify an action and who performs it.',
    'Identify the GOAL behind it — what the person hoped would happen next.',
    'Separate that goal from the cause: purpose looks forward, reason looks backward.',
    'Ask why X did it, or what X was trying to achieve.',
    'Write the correct option as the intended goal.'
  ],
  distractors: [
    'The REASON the action happened rather than its intended goal.',
    'An actual consequence of the action, which may differ from what was wanted.',
    'A goal that belongs to a different action in the passage.'
  ],
  selfCheck: [
    'Does your correct option describe an intention (forward-looking), not a cause (backward-looking)?',
    'Does the passage show the intent, rather than you assuming what a person would normally want?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "purpose",
    "question": "What was Mai trying to achieve by going to the market early?",
    "options": ["To avoid the afternoon rain", "To get the cheapest fabric before it sold out", "To meet her sister there", "To sell her old bag"],
    "correctAnswer": 1,
    "explanation": "Đoạn 1 cho thấy Mai đi chợ sớm để mua được vải rẻ trước khi hết hàng."
  }
}`,
  pitfalls: [
    'Blurring purpose into reason. Reason = why something happened. Purpose = what someone wanted to achieve.',
    'Using the outcome as the intent when the passage shows the plan did not work out.',
    'Attributing a goal the text never indicates.'
  ]
};
