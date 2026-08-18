import type { ReadingQuestionTypeModule } from '../module';

export const predictionModule: ReadingQuestionTypeModule = {
  type: 'prediction',
  role: 'You write ONE evidence-based prediction question: what will most likely happen next.',
  evidence: 'the current situation, an unresolved goal or problem, and a direction the text clearly points in',
  method: [
    'State where the story stands when the passage ends.',
    'Identify what is still unresolved — a goal not yet reached, a problem not yet fixed.',
    'Find the direction the passage points: a stated plan, a trend, a decision just made.',
    'Derive the most likely next step, keeping it modest and close to the evidence.',
    'Ask what will most likely happen next.'
  ],
  distractors: [
    'An outcome that contradicts the direction the passage sets up.',
    'A possible but far less supported continuation.',
    'Something that already happened in the passage, offered as if it were still ahead.'
  ],
  selfCheck: [
    'Is the prediction grounded in something the passage actually states, not in what usually happens in stories?',
    'Does the passage leave something genuinely unresolved? If it closes cleanly, this type does not fit.'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "prediction",
    "question": "What will Mai most likely do next?",
    "options": ["Buy a bag from the shop after all", "Make another bag for her sister", "Stop sewing for good", "Sell the fabric she has left"],
    "correctAnswer": 1,
    "explanation": "Đoạn 3 nói em gái Mai cũng muốn một chiếc như vậy, nên khả năng cao Mai sẽ làm tiếp chiếc nữa."
  }
}`,
  pitfalls: [
    'Predicting from genre convention rather than from this passage.',
    'Making a leap far beyond the next step.',
    'Using this type on a passage that ends fully resolved, leaving nothing to predict.'
  ]
};
