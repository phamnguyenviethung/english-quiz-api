import type { ReadingQuestionTypeModule } from '../module';

export const reasonModule: ReadingQuestionTypeModule = {
  type: 'reason',
  role: 'You write ONE action-to-reason question: why someone did something, with the reason stated in the text.',
  evidence: 'an action or decision together with the reason the text gives for it',
  method: [
    'Find an action or decision a character makes.',
    'Find the reason the passage states for it — look for "because", "so", "since", or a sentence placed to explain the action.',
    'Confirm the reason is written down, not something you inferred.',
    'Ask "Why did X ...?".',
    'Write the correct option as that stated reason.'
  ],
  distractors: [
    'Another real fact from the passage that is NOT the reason for this action.',
    'A reason that sounds sensible in real life but is never given in the text.',
    'The RESULT of the action instead of its cause — a very tempting wrong answer.'
  ],
  selfCheck: [
    'Is the reason written in the passage? If you had to guess it, drop this question.',
    'Is your correct option the cause, not the outcome?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "reason",
    "question": "Why did Mai decide to make her own bag?",
    "options": ["She wanted to learn to sew", "The bags in the shop were too expensive", "Her old bag was lost", "Her friend asked her to"],
    "correctAnswer": 1,
    "explanation": "Đoạn 1 cho biết Mai tự làm túi vì túi ngoài cửa hàng quá đắt."
  }
}`,
  pitfalls: [
    'Confusing reason with purpose. Reason = why it happened. Purpose = what the person wanted to achieve.',
    'Offering the consequence of the action as the correct answer.',
    'Inventing a plausible motive the passage never states.'
  ]
};
