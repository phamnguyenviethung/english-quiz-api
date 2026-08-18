import type { ReadingQuestionTypeModule } from '../module';

export const attitudeModule: ReadingQuestionTypeModule = {
  type: 'attitude',
  role: 'You write ONE attitude question: how a character or the writer feels about something.',
  evidence: 'several clues — words chosen, actions taken, reactions, dialogue — pointing to one stance',
  method: [
    'Collect the clues that reveal feeling: what the person does, how they react, the words the writer uses to describe them.',
    'Require MORE THAN ONE clue. A single adjective is not enough to fix an attitude.',
    'Name the attitude in one word to yourself, then check every clue is consistent with it.',
    "Ask how X felt about something, or what X's attitude toward it was.",
    'Write the correct option as that attitude, worded at the right strength.'
  ],
  distractors: [
    'A plausible emotion the passage gives no evidence for.',
    'The right feeling at the wrong intensity — "furious" when the text supports "annoyed".',
    'An attitude that fits one isolated clue but contradicts the others.'
  ],
  selfCheck: [
    'Can you name at least two clues supporting the attitude?',
    'Is the strength of your correct option matched to the text, not exaggerated?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "attitude",
    "question": "How did Mai feel about the finished bag?",
    "options": ["Disappointed with the result", "Quietly proud of it", "Indifferent to it", "Worried about showing it"],
    "correctAnswer": 1,
    "explanation": "Đoạn 3 tả Mai mỉm cười khi ngắm chiếc túi và mang nó đi mỗi ngày, cho thấy cô thầm tự hào."
  }
}`,
  pitfalls: [
    'Inferring an attitude from one isolated clue.',
    'Overstating intensity — most passages support mild feelings, not extreme ones.',
    'Projecting how a reader would feel instead of what the text shows the character feeling.'
  ]
};
