import type { ReadingQuestionTypeModule } from '../module';

export const specificFunctionModule: ReadingQuestionTypeModule = {
  type: 'specific_function',
  role: 'You write ONE detail-function question: why the writer put a particular detail in the passage.',
  evidence: 'a detail with a clear job in the passage, plus the context around it that reveals that job',
  method: [
    'Pick a detail that is doing work — not decoration.',
    'Read what comes immediately before and after it.',
    'Name its function: introduce a problem, explain a reason, show a consequence, provide evidence, or create contrast.',
    'Ask why the writer mentions that detail.',
    'Write the correct option as that function, phrased in plain language.'
  ],
  distractors: [
    'A different function from the list, applied to the same detail.',
    'A restatement of the detail itself rather than its role.',
    'The function of a NEIGHBOURING detail instead of the one asked about.'
  ],
  selfCheck: [
    'Does the detail genuinely have a role, or is it scenery? If scenery, choose another detail or say the type does not fit.',
    'Does your correct option describe the ROLE, not repeat the content?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "specific_function",
    "question": "Why does the writer mention the price of the shop bags?",
    "options": ["To describe the shop", "To set up the problem Mai has to solve", "To show the shop was popular", "To compare two shops"],
    "correctAnswer": 1,
    "explanation": "Đoạn 1 nêu giá đắt để dựng lên vấn đề mà Mai phải giải quyết ở các đoạn sau."
  }
}`,
  pitfalls: [
    'Choosing a purely decorative detail that has no function.',
    'Writing options that paraphrase the detail instead of naming its purpose.',
    'Assigning a function the surrounding text does not support.'
  ]
};
