import { type EngLevel } from '../../questionTypes';

// Phần prompt KHÔNG phụ thuộc quiz type. Mỗi lần sinh 1 câu = common block này + đúng
// một module type (types/*.ts). Sửa rule chung thì chỉ sửa ở đây.

export const OPTIONS_PER_QUESTION = 4;

/** Đánh số đoạn để model neo explanation vào đúng đoạn ("Đoạn 2 nói rõ..."). */
export function buildPassageBlock(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((paragraph, index) => `[${index + 1}] ${paragraph}`).join('\n\n');
  return `Title: ${title}

${body}`;
}

/**
 * Mỗi câu sinh bằng một lần gọi riêng nên model KHÔNG thấy các câu khác. Block này là
 * cơ chế duy nhất giữ tính độc lập giữa các câu trong cùng một bài.
 */
export function buildIndependenceBlock(previousQuestions: string[]): string {
  if (previousQuestions.length === 0) return '';
  const list = previousQuestions.map((question) => `  - ${question}`).join('\n');
  return `
─── ALREADY ASKED ABOUT THIS PASSAGE ───────────────────────────────────────────

These questions already exist for this passage:
${list}

Your question must target a DIFFERENT information point — not the same fact asked in
other words, and not a fact whose answer is already given away above.

A passage that supports one question almost always supports several more, and the
questions above rarely exhaust it. Different question types also look at different things:
a question about a word does not use up a question about an event. So find another point;
this block is NOT a reason to give up on your assigned type.
`;
}

export function buildSchemaBlock(quizType: string): string {
  return `Return ONLY valid JSON (no markdown, no commentary):
{
  "question": {
    "quizType": "${quizType}",
    "question": string,
    "options": [string, string, string, string],
    "correctAnswer": number,
    "explanation": string
  }
}`;
}

export function buildPassageSection(input: {
  title: string;
  paragraphs: string[];
  topicName: string;
  cefrLevel: EngLevel;
}): string {
  return `─── PASSAGE (topic: "${input.topicName}", level: ${input.cefrLevel}) ───────────────────────

${buildPassageBlock(input.title, input.paragraphs)}

The [1], [2], ... markers number the paragraphs for YOUR reference only. The learner never sees them — they read the passage as plain prose.

So the question and its options must NEVER refer to a paragraph by number. Write "What does 'sews' mean?", never "In paragraph 2, what does 'sews' mean?". You may refer to paragraph numbers inside "explanation" — that field is for the reviewer, not the learner.`;
}

export function buildLevelSection(cefrLevel: EngLevel): string {
  return `─── LEVEL: ${cefrLevel} ──────────────────────────────────────────────────────────

Vocabulary, sentence complexity and cognitive load in the question and options must fit ${cefrLevel}. Difficulty must come from the reasoning the question demands, never from unnecessarily hard wording.`;
}

export function buildOutputRulesSection(): string {
  return `"correctAnswer" is the 0-BASED INDEX of the correct entry in "options" — a number, not a letter, not the answer text. If the correct option is the third one, "correctAnswer" is 2.

Vary where you put the correct answer. Do not default to index 0.

"explanation" is ONE sentence in VIETNAMESE saying why the answer is correct and which paragraph the evidence is in — for example: "Đoạn 2 nói rõ Anna gặp bạn ở quán cà phê."`;
}

export function buildCorePrinciplesSection(): string {
  return `─── CORE PRINCIPLES ────────────────────────────────────────────────────────────

Evidence first: the question starts from evidence in the passage — question → evidence in passage → correct answer. Never write a question first and look for justification afterwards.

One defensible correct answer: exactly one option is best. The answer must be explicitly stated, safely paraphrased, or logically inferred from sufficient evidence. Two reasonably correct options is a critical failure.

Answerable from the passage alone: a learner who has read only this passage must be able to answer. No outside knowledge, ever.`;
}

export function buildDistractorSection(): string {
  return `─── DISTRACTOR STRATEGY ────────────────────────────────────────────────────────

Distractors must be plausible but definitely wrong. Good sources:
  - another real fact from the passage
  - the correct fact attached to the wrong person, time, or place
  - a partial truth
  - a logical but unsupported interpretation
  - a close paraphrase with exactly one detail changed

Avoid:
  - obviously ridiculous or unrelated options
  - vocabulary much harder than the correct answer
  - options that are obviously different in length from the others
  - more than one defensible answer, or any ambiguous option`;
}

export function buildCommonSelfCheck(cefrLevel: EngLevel): string {
  return `  1. Can you point to the exact sentence(s) in the passage that support the answer?
     → if NO → you cannot write this question. Say the passage does not support the type.
  2. Is exactly ONE option correct, with no second option defensible?
     → if NO → rewrite the distractor that is also arguable.
  3. Does the answer actually answer the question asked?
     → if NO → fix the wording.
  4. Does "correctAnswer" point at the index of the correct option? Recount from 0.
     → if NO → fix the number.
  5. Are all ${OPTIONS_PER_QUESTION} options distinct, similar in length, and free of ambiguity?
     → if NO → rewrite the offending options.
  6. Does the vocabulary and reasoning load fit ${cefrLevel}?
     → if NO → simplify the wording, not the reasoning.
  7. Does the question or any option mention a paragraph number ("in paragraph 2", "the second paragraph")?
     → if YES → rewrite it without the reference. The learner cannot see paragraph numbers.`;
}

export function buildQualityConstraintsSection(): string {
  return `─── QUALITY CONSTRAINTS ────────────────────────────────────────────────────────

- Never require outside knowledge, and never ask about something the passage does not state.
- Never quote paragraph numbers, "the passage says", or "according to the text" as the subject of the question — ask about the content itself.
- Do not output evidence fields, teaching notes, or anything outside the JSON shape above.
- Content must be appropriate for language learners of any age.`;
}
