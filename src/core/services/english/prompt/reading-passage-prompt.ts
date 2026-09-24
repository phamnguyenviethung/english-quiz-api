import { type EngLevel } from '../questionTypes';
import { buildBeginnerReadingLevelBlock } from './beginner-prompt';

// Reading passage = bài đọc thuần, KHÔNG kèm câu hỏi (khác hẳn reading-prompt.ts —
// file đó sinh quiz đọc hiểu + mental math). Toàn bộ rule dưới đây bám theo
// docs/reading-prompt-guideline.md; sửa guideline thì sửa cả file này.

export interface ReadingPassage {
  title: string;
  paragraphs: string[];
  wordCount: number;
  topic: string;
  cefrLevel: EngLevel;
}

/** Guideline mục 2: mọi CEFR level dùng chung một band độ dài. */
export const READING_WORD_BAND = { min: 150, max: 220 } as const;

/**
 * Ngưỡng accept khi validate bài model trả về — nới nhẹ quanh band vì cách đếm từ của
 * model không khớp tuyệt đối với countPassageWords (split whitespace). Loại quá gắt thì
 * tỉ lệ hỏng batch cao mà chất lượng không hơn.
 */
export const READING_WORD_ACCEPT = { min: 140, max: 235 } as const;

// Guideline mục 11. Độ dài giống nhau ở mọi level nên level CHỈ được thể hiện qua từ
// vựng, độ phức tạp câu và cách triển khai ý.
const LEVEL_GUIDES: Record<EngLevel, string> = {
  A1: 'Very common everyday words only. Short simple sentences, mostly present tense. Avoid embedded clauses and phrasal verbs beyond the most basic ones. Grammar complexity must stay low.',
  A2: 'Common everyday vocabulary plus a few useful new words. Simple and compound sentences; past and future tenses are fine. Keep clause chains short.',
  B1: 'Intermediate vocabulary including some useful collocations. Compound and complex sentences in moderation; connectors and fuller description are fine, but keep the narrative easy to follow.',
  B2: 'Natural vocabulary including idiomatic expressions where they fit. More complex structures (relative clauses, conditionals, passive) and more varied sentence patterns are allowed, but the writing must still read smoothly.'
};

/**
 * Guideline mục 5 — target mix của question points. Passage phải đỡ được 5-7 điểm này
 * để pipeline sinh câu hỏi có cái mà chọn, dù cuối cùng chỉ dùng 3 câu.
 */
export const QUESTION_POINT_TARGETS = [
  '2-3 explicit details — facts stated outright in the text',
  '1 reason / cause — why someone did something',
  '1 inference — something not stated, but supported by at least TWO separate clues in the text',
  '1 vocabulary in context — a useful word whose meaning is recoverable from the surrounding sentences',
  '1 main idea / purpose — what the passage is mostly about',
  '1 sequence or cause-effect point — the order things happened, or what led to what (when it fits)'
] as const;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

export function countPassageWords(paragraphs: string[]): number {
  return countWords(paragraphs.join(' '));
}

function buildBatchInstruction(count: number): string {
  if (count <= 1) return '';
  return `
BATCH GENERATION — ${count} PASSAGES REQUIRED:
Return EXACTLY ${count} independent passages in the "passages" array.

Each passage MUST independently satisfy EVERY rule in this prompt as if it were generated alone:
  - Its own single central situation, its own 5-7 information points, its own Situation → Development → Result arc
  - Its own word count inside the required band
  - Its own title

UNIQUENESS across the batch:
  - No two passages share a plot, a setting, or a main character type
  - No two passages open with the same sentence pattern
  - Vary who the story is about (student / worker / parent / traveller / neighbour / shop owner ...)
  - Vary the outcome (a problem solved, a plan changed, a small discovery, a decision made, a favour returned)

COMMON BATCH FAILURES — avoid:
  - Writing passage 1 carefully then rushing the rest
  - Reusing the same "someone forgets something and then fixes it" shape across items
  - Drifting outside the word band on later items
  - Letting later passages thin out until only detail questions could be asked about them
`;
}

function buildExcludeInstruction(excludeTitles: string[]): string {
  if (excludeTitles.length === 0) return '';
  const list = excludeTitles.map((title) => `  - ${title}`).join('\n');
  return `
ALREADY USED — do NOT repeat these stories:
These passages already exist for this topic and level. Write something clearly different:
${list}

Different means: a different situation, different characters, and a different outcome — not the same story with new names.
`;
}

function buildSchemaBlock(count: number, cefrLevel: EngLevel, topicName: string): string {
  const passageShape = `{
  "title": string,
  "paragraphs": [string, ...],
  "wordCount": number,
  "topic": "${topicName}",
  "cefrLevel": "${cefrLevel}"
}`;

  return count > 1
    ? `Return ONLY valid JSON matching: { "passages": [array of ${count} objects matching the shape below] }

Each object (no markdown, no commentary):
${passageShape}`
    : `Return ONLY valid JSON (no markdown, no commentary):
${passageShape}`;
}

export function buildReadingPassagePrompt(input: {
  topicName: string;
  cefrLevel: EngLevel;
  count?: number;
  excludeTitles?: string[];
  forBeginner?: boolean;
}): string {
  const { topicName, cefrLevel } = input;
  const count = input.count ?? 1;
  const { min, max } = READING_WORD_BAND;

  return `You are a reading-passage writer for Vietnamese learners of English.

Your job is to write short "micro-readings" — a learner should finish one in about 10 minutes, including looking up a few words. Each passage will later be turned into 3 comprehension questions by a SEPARATE pipeline. You do not write questions.
${buildBatchInstruction(count)}${buildExcludeInstruction(input.excludeTitles ?? [])}
─── TOPIC LOCK — "${topicName}" ────────────────────────────────────────────────

This is a HARD CONSTRAINT, not a suggestion. The situation in the passage must plausibly belong to the "${topicName}" domain — a reader should immediately recognise it as a "${topicName}" story.

- Prefer a concrete, specific situation over an abstract treatment of the topic.
- Fictional people, places and events are welcome. You do NOT need a true story.
- Do NOT write about science, academia, politics, history, or technical subjects unless "${topicName}" itself is one of those.
- The reader must not need any outside knowledge to understand the passage.

─── LEVEL: ${cefrLevel} ──────────────────────────────────────────────────────────

${input.forBeginner ? buildBeginnerReadingLevelBlock(cefrLevel) : LEVEL_GUIDES[cefrLevel]}

Every level uses the SAME length. The level must show through vocabulary, sentence complexity and how ideas are connected — NEVER through how long the passage is. Do not stretch sentences at a low level to fill space, and do not compress a high level into simple ones.

Length: ${min}-${max} words total, across all paragraphs — this applies to every CEFR level.
- Do NOT pad the story to reach the word count. A tight ${min}-word passage beats a padded ${max}-word one.
- Do NOT add sentences that carry no information.

${buildSchemaBlock(count, cefrLevel, topicName)}

─── STRUCTURE ──────────────────────────────────────────────────────────────────

Exactly ONE central situation per passage, told in 3-4 paragraphs following this arc:
  1. Situation — who, where, what is going on
  2. Development — the problem, the complication, or the action taken
  3. Result — how it ended: a decision, a change, a small realisation

Include 5-7 meaningful information points — a character, a setting, an action, a reason, a problem, a decision, a result, a telling detail. Every one must connect logically to the others; no loose trivia dropped in.

- Spread the information across the passage. Do NOT pack the useful facts into one sentence and leave the rest empty.
- Every paragraph must contribute at least one piece of meaningful information.
- Favour concrete people, places, actions, problems and decisions over general statements.
- The passage must be self-contained: everything needed to understand it is inside it.

"title": a short natural title (3-8 words) for the story. Not a summary of the moral, not a question.
"paragraphs": an array of paragraph strings, in order. No newline characters inside a paragraph.
"wordCount": the ACTUAL number of words across all paragraphs. Count them.

─── QUESTION-READINESS — the most important property ───────────────────────────

Another pipeline will generate 3 different comprehension questions from this passage. Your job is to leave it plenty to choose from: aim for 5-7 potential question points of these kinds.

${QUESTION_POINT_TARGETS.map((target, index) => `  ${index + 1}. ${target}`).join('\n')}

Not every passage needs all of them, but a passage that only supports one kind has failed.

- Density: roughly every 40-60 words should carry at least one meaningful question point.
- Independence: at least 3 of the points must sit on DIFFERENT information, so three questions can be answered in any order without one revealing the answer to another.
- Diversity: the passage must support at least 2-3 different kinds from the list above. A passage where only detail questions are possible, or only vocabulary questions, is a failure.

─── ANSWERABILITY ──────────────────────────────────────────────────────────────

Every question written from this passage must be answerable using ONLY the passage. Aim for answers that are DEFENSIBLE, not merely plausible.

- Details: stated outright, or paraphrased clearly enough that the answer is not in doubt.
- Inference: supported by at least TWO separate clues in the text. Never require a leap the text does not back up.
- Reason / cause-effect: the link between cause and action, or action and result, must be visible in the text.
- Vocabulary in context: the surrounding sentences must give enough clues to work out the meaning.
- Nothing may depend on outside knowledge, an unevidenced opinion, or information you did not write down.

─── VOCABULARY ─────────────────────────────────────────────────────────────────

- Most words should already be familiar at ${cefrLevel}; a few useful new ones are fine.
- Prefer vocabulary a learner will actually use in daily life. Never use academic words the topic does not call for.
- Include 1-3 useful target words whose meaning is recoverable from context.
- Do NOT stuff hard words in just to create vocabulary questions.
- Target words must not be obscure, must not have several meanings that fit equally well here, and must never be proper nouns.

─── DISTRACTOR READINESS ───────────────────────────────────────────────────────

The question pipeline may build multiple-choice options, so the passage should contain enough real material to draw wrong-but-tempting options from:
  - a second person, place or object of the same kind (right fact, wrong subject)
  - a second point in time (right fact, wrong moment)
  - a second real action that is not the answer to a given question

But do NOT let two facts sit so close together that a wrong option could also be read as correct. Each fact must be clearly attached to its own subject, time and outcome.

─── AMBIGUITY PREVENTION ───────────────────────────────────────────────────────

- Every pronoun must have one obvious antecedent. "they", "it", "this", "that" must never be guessable in two ways.
- Never let two characters both plausibly be the subject of the same action.
- When the order of events matters, make it unmistakable.
- Keep cause and result clearly distinguishable from each other.
- Do not use wording that supports two reasonable interpretations, and do not contradict yourself anywhere in the passage.

─── NATURALNESS ────────────────────────────────────────────────────────────────

- Write the way a fluent native speaker actually writes: natural rhythm, natural word choice.
- A short line of dialogue is fine when it serves the situation — never add dialogue just for variety.
- Avoid textbook voice ("Today I will tell you about...", "In conclusion...").
- Avoid the flat, over-explained register that makes text feel machine-written.
- Do not over-use formal language.

─── VARIETY ────────────────────────────────────────────────────────────────────

Do NOT open with these tired shapes:
  "Someone forgot ..." / "Someone went to ..." / "Someone decided ..."

Vary characters, settings, problems, actions, outcomes, and narrative style between passages. Some stories should be about a small win, some about a mistake, some about noticing something, some about helping someone.

─── DO NOT WRITE QUESTIONS ─────────────────────────────────────────────────────

Output the passage only. No questions, no answer options, no vocabulary list, no translation, no teaching notes. Question generation is a separate step.

─── FINAL SELF-CHECK — before you output ───────────────────────────────────────

1. Count the words across all paragraphs. Is the total between ${min} and ${max}?
   - Over ${max}? Cut whole sentences that add the least information. Do NOT just trim adjectives.
   - Under ${min}? Add one more concrete detail that a question could be asked about.
2. Set "wordCount" to the number you just counted, not an estimate.
3. Are there 5-7 meaningful information points, spread across the paragraphs rather than bunched into one?
4. Pick 3 DIFFERENT information points and check you could write one question on each — of at least two different kinds — answerable from the text alone, in any order.
5. Does every pronoun point to exactly one person or thing? Could any sentence be read two ways? Fix it.
6. Does anything in the passage contradict anything else? Fix it.

─── QUALITY CONSTRAINTS ────────────────────────────────────────────────────────

- Do not invent factual claims about real people, brands, places, or events.
- No sensitive, political, or controversial content unless the topic genuinely requires it.
- Never reproduce source text verbatim. If you draw on something you know, rewrite it completely.
- Content must be appropriate for language learners of any age.
- Readability and questionability matter more than packing in information.

Output JSON only.`;
}
