import type { ReadingQuestionTypeModule } from '../module';

export const sequenceModule: ReadingQuestionTypeModule = {
  type: 'sequence',
  role: 'You write ONE temporal-ordering question: what happened first, next, or after something else.',
  evidence: 'at least THREE clearly distinguishable events whose order the text makes unambiguous',
  method: [
    'List the events in the passage in the order they actually happen.',
    'Check the text really fixes the order — look for first, then, after, before, later, finally, or explicit times.',
    'If fewer than three events are clearly ordered, the passage does not support this type. Say so.',
    'Ask what happened first, what happened next, or what happened after a named event.',
    'Write the correct option as the event that truly occupies that position.'
  ],
  distractors: [
    'A real event from the passage placed at the wrong point in the timeline.',
    'The event immediately before or after the correct one — the most instructive near-miss.',
    'An event that happened, but in a different part of the story than the question asks about.'
  ],
  selfCheck: [
    'Does the passage fix the order beyond doubt, or are you assuming it from sentence order alone?',
    'Are there genuinely three or more distinguishable events?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "sequence",
    "question": "What did Linh do right after she watered the plants?",
    "options": ["She made breakfast", "She left for work", "She fed the cat", "She checked her phone"],
    "correctAnswer": 3,
    "explanation": "Đoạn 2 kể Linh tưới cây xong thì xem điện thoại."
  }
}`,
  pitfalls: [
    'Assuming the order things are MENTIONED is the order they HAPPENED. A passage can mention an earlier event later.',
    'Building the question on only two events.',
    'Using events whose relative timing the text never pins down.'
  ]
};
