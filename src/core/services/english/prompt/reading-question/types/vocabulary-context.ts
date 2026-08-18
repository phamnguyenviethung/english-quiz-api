import type { ReadingQuestionTypeModule } from '../module';

export const vocabularyContextModule: ReadingQuestionTypeModule = {
  type: 'vocabulary_context',
  role: 'You write ONE contextual-meaning question: what a word means in THIS passage, worked out from the surrounding text.',
  evidence: 'a useful target word whose meaning is recoverable from the sentences around it',
  method: [
    'Find words in the passage whose meaning the surrounding text explains or demonstrates.',
    'Pick one that is genuinely useful for a learner at this level — a word they will meet again.',
    'Re-read the sentence it sits in plus the sentences before and after, and name the clues that give it away.',
    'Decide the meaning IN THIS CONTEXT, not the dictionary meaning of another sense.',
    'Ask what the word most likely means, quoting the word itself.'
  ],
  distractors: [
    'A different real sense of the same word that does NOT fit this context.',
    'A meaning that fits the topic in general but contradicts this sentence.',
    'A meaning close to the right one but wrong in degree or direction (bigger/smaller, start/finish).'
  ],
  selfCheck: [
    'Could a learner work out the meaning from this passage WITHOUT a dictionary? If not, pick a different word.',
    'Is the target word free of ambiguity here — only one sense fits?',
    'Is the target word NOT a proper noun and NOT obscure?'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "vocabulary_context",
    "question": "What does 'sews' most likely mean here?",
    "options": ["cuts into pieces", "joins with thread", "washes carefully", "folds neatly"],
    "correctAnswer": 1,
    "explanation": "Đoạn 2 tả Mai cắt vải rồi nối các mảnh lại bằng kim chỉ, nên 'sews' nghĩa là khâu nối."
  }
}`,
  pitfalls: [
    'Choosing a word the passage never explains, so the learner needs prior knowledge.',
    'Choosing a word with several senses that all fit here.',
    'Testing a word so easy that the question is pointless at this level.'
  ]
};
