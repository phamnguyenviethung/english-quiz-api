import type { ReadingQuestionTypeModule } from '../module';

export const comparisonModule: ReadingQuestionTypeModule = {
  type: 'comparison',
  role: 'You write ONE comparison question: how two things in the passage are alike or different.',
  evidence: 'two entities or events that the passage describes along the SAME attribute',
  method: [
    'Identify entity A and entity B — two people, places, objects, or events the passage treats.',
    'Find an attribute the text gives for BOTH: cost, size, time taken, difficulty, mood, outcome.',
    'If the passage only describes that attribute for one of them, this type does not fit. Say so.',
    'Compare them along that single attribute.',
    'Ask how they are similar or how they differ.'
  ],
  distractors: [
    'A comparison along an attribute the text gives for only one of the two.',
    'A true statement about A alone, with no comparison in it.',
    'A reversed comparison — right attribute, wrong direction.'
  ],
  selfCheck: [
    'Does the passage give textual evidence for BOTH sides of the comparison?',
    'Is the comparison along one clear attribute, not a vague overall impression?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "comparison",
    "question": "How did the handmade bag differ from the shop bags?",
    "options": ["It was larger", "It cost far less to make", "It took less time to get", "It was made of leather"],
    "correctAnswer": 1,
    "explanation": "Đoạn 1 nêu giá túi ngoài cửa hàng, đoạn 2 nêu chi phí vải, cho thấy túi tự làm rẻ hơn hẳn."
  }
}`,
  pitfalls: [
    'Comparing along an attribute described for only one side.',
    'Writing an option that describes one entity without actually comparing.',
    'Forcing a comparison when the passage has only one entity of that kind.'
  ]
};
