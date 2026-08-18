import type { ReadingQuestionTypeModule } from '../module';

export const causeEffectModule: ReadingQuestionTypeModule = {
  type: 'cause_effect',
  role: 'You write ONE causal-relationship question: what caused something, or what happened because of it.',
  evidence: 'a genuine cause → effect link that the passage asserts, not merely two events in a row',
  method: [
    'Extract the events of the passage.',
    'Look for a pair where the text says one BROUGHT ABOUT the other — "because", "so", "that is why", "as a result", or an explanation the writer clearly intends as causal.',
    'Test the link: if the cause were removed, would the effect still follow? If the text does not commit to that, this is not a causal pair.',
    'Ask either "What caused X?" or "What happened because of X?".',
    'Write the correct option as the other half of the pair.'
  ],
  distractors: [
    'An event that happened just BEFORE the effect but did not cause it — the core trap of this type.',
    'A real consequence of a different cause in the passage.',
    'A cause that is plausible in real life but that the text never links to this effect.'
  ],
  selfCheck: [
    'Does the passage actually assert causation, or are you inferring it from the order of sentences?',
    'Would swapping cause and effect make your question nonsense? If the direction does not matter, the link is not causal.'
  ],
  example: `STRUCTURE ONLY — do NOT copy this content.
{
  "question": {
    "quizType": "cause_effect",
    "question": "What made the shop close early that day?",
    "options": ["A power cut in the street", "The owner felt unwell", "There were no customers", "A delivery arrived late"],
    "correctAnswer": 0,
    "explanation": "Đoạn 2 nói cửa hàng đóng sớm vì khu phố mất điện."
  }
}`,
  pitfalls: [
    'A happened before B does NOT mean A caused B. If the passage only shows sequence, this is the wrong type — say the passage does not support it and do not force a question.',
    'Presenting a correlation the writer never claims as causal.',
    'Reversing the direction so the effect is offered as the cause.'
  ]
};
