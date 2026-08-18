import type { ReadingQuestionTypeModule } from '../module';

export const mainIdeaModule: ReadingQuestionTypeModule = {
  type: 'main_idea',
  role: 'You write ONE global-understanding question: what the whole passage is mainly about.',
  evidence: 'the central topic plus the central situation or development running through the passage',
  method: [
    'Read the whole passage and state its central idea in one sentence to yourself.',
    'Check that sentence covers the beginning, middle and end, not just one part.',
    'Deliberately ignore vivid but minor details.',
    'Ask what the passage is mainly about.',
    'Write the correct option as a compact summary of the whole thing.'
  ],
  distractors: [
    'A statement that is TOO NARROW — true, but only about one paragraph.',
    'A statement that is TOO BROAD — about the topic in general, beyond what this passage says.',
    'A real but minor detail dressed up as if it were the point of the passage.'
  ],
  selfCheck: [
    'Does your correct option describe the WHOLE passage, or only part of it?',
    'Is every distractor wrong for a clear structural reason (too narrow / too broad / minor detail)?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "main_idea",
    "question": "What is the passage mainly about?",
    "options": ["How to choose fabric at a market", "How Mai solved a problem by making something herself", "Why shops in the city are expensive", "Mai's friendship with her sister"],
    "correctAnswer": 1,
    "explanation": "Cả bài xoay quanh việc Mai tự làm túi để giải quyết vấn đề giá đắt."
  }
}`,
  pitfalls: [
    'Choosing the most memorable detail instead of the actual through-line.',
    'Writing a correct option so broad it would fit any passage on this topic.',
    'Distractors that are simply false rather than wrong in scope — this type is about scope.'
  ]
};
