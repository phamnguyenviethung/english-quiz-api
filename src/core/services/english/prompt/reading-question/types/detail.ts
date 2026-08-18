import type { ReadingQuestionTypeModule } from '../module';

export const detailModule: ReadingQuestionTypeModule = {
  type: 'detail',
  role: 'You write ONE explicit-information-retrieval question: the answer is stated outright in the passage.',
  evidence: 'one meaningful factual detail stated in the text: a person, place, time, object, action, or event',
  method: [
    'Scan the passage and list the concrete facts actually written down.',
    'Pick ONE fact that matters to the story, not a decorative adjective.',
    'Turn it into a Who / What / Where / When / How question.',
    'Paraphrase the passage wording in the question so the learner cannot answer by pattern-matching a repeated phrase.',
    'Write the correct option as the fact itself, worded plainly.'
  ],
  distractors: [
    'Another real fact from the passage that answers a different question.',
    'The same fact with one attribute swapped: wrong person, wrong place, wrong time, wrong quantity.',
    'A detail from a different part of the story that a careless reader would grab first.'
  ],
  selfCheck: [
    'Is the answer stated in the text, with NO inference needed at all? If the learner has to reason, this is the wrong type.',
    'Did you paraphrase, rather than copy the sentence verbatim into the question?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "detail",
    "question": "Where did Mai buy the fabric?",
    "options": ["At a market near her house", "At a shop in the city centre", "At her aunt's shop", "Online"],
    "correctAnswer": 0,
    "explanation": "Đoạn 2 nói rõ Mai mua vải ở khu chợ gần nhà."
  }
}`,
  pitfalls: [
    'Asking about a trivial detail (a colour mentioned once in passing) instead of a fact that carries the story.',
    'Copying the passage sentence word-for-word into the question, so the answer is found by matching text rather than reading.',
    'Writing a question that actually needs inference — that belongs to another type.'
  ]
};
