import { type EngLevel } from '../questionTypes';

// Reading passage = bài đọc thuần, KHÔNG kèm câu hỏi (khác hẳn reading-prompt.ts —
// file đó sinh quiz đọc hiểu + mental math). Toàn bộ rule dưới đây bám theo
// reading-prompt-guideline.md ở root repo; sửa guideline thì sửa cả file này.

export interface ReadingPassage {
  title: string;
  paragraphs: string[];
  wordCount: number;
  topic: string;
  cefrLevel: EngLevel;
}

// Guideline mục 2. Dùng cả ở prompt lẫn validate sau khi model trả về.
export const CEFR_WORD_BANDS: Record<EngLevel, { min: number; max: number }> = {
  A1: { min: 70, max: 100 },
  A2: { min: 90, max: 130 },
  B1: { min: 120, max: 170 },
  B2: { min: 140, max: 190 }
};

// Guideline mục 6 + 7 gộp lại theo từng level.
const LEVEL_GUIDES: Record<EngLevel, string> = {
  A1: 'Very common everyday words only. Short simple sentences, mostly present tense. Avoid subordinate clauses and phrasal verbs beyond the most basic ones.',
  A2: 'Common everyday vocabulary plus a few useful new words. Simple and compound sentences; past and future tenses are fine. Keep clause chains short.',
  B1: 'Intermediate vocabulary including some useful collocations. Compound and complex sentences in moderation; a mix of tenses is fine, but keep the narrative easy to follow.',
  B2: 'Natural vocabulary including idiomatic expressions where they fit. More complex structures (relative clauses, conditionals, passive) are allowed, but the writing must still read smoothly.'
};

export const QUESTION_ANGLES = [
  'Detail — a specific fact stated in the passage',
  'Reason — why someone did something',
  'Main idea — what the passage is mostly about',
  'Inference — something strongly implied but not stated',
  'Vocabulary in context — the meaning of a word as used here',
  'Sequence — the order in which things happened',
  'Cause & effect — what led to what'
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
  - Its own single central situation, its own 3-6 facts, its own Situation → Development → Result arc
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
}): string {
  const { topicName, cefrLevel } = input;
  const count = input.count ?? 1;
  const band = CEFR_WORD_BANDS[cefrLevel];

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

${LEVEL_GUIDES[cefrLevel]}

Length: ${band.min}-${band.max} words total, across all paragraphs.
- Do NOT pad the story to reach the word count. A tight ${band.min}-word passage beats a padded ${band.max}-word one.
- Do NOT add sentences that carry no information.

${buildSchemaBlock(count, cefrLevel, topicName)}

─── STRUCTURE ──────────────────────────────────────────────────────────────────

Exactly ONE central situation per passage, told in 2-4 paragraphs following this arc:
  1. Situation — who, where, what is going on
  2. Development — the problem, the complication, or the action taken
  3. Result — how it ended: a decision, a change, a small realisation

Include 3-6 clear facts or details. Every fact must connect logically to the others — no loose trivia dropped in.
The passage must be self-contained: everything needed to understand it is inside it.
Favour concrete people, places, actions, problems and decisions over general statements.

"title": a short natural title (3-8 words) for the story. Not a summary of the moral, not a question.
"paragraphs": an array of paragraph strings, in order. No newline characters inside a paragraph.
"wordCount": the ACTUAL number of words across all paragraphs. Count them.

─── QUESTIONABILITY — the most important property ──────────────────────────────

Another pipeline will generate 3 different comprehension questions from this passage. The passage must give it enough material to work with. A reader should be able to answer questions of these kinds using ONLY the passage:

${QUESTION_ANGLES.map((angle, index) => `  ${index + 1}. ${angle}`).join('\n')}

Concretely, that means the passage needs:
  - at least one clearly stated fact worth asking about (Detail)
  - a stated or clearly implied motivation for someone's action (Reason / Inference)
  - events that happen in a definite order (Sequence / Cause & effect)
  - at least one useful word whose meaning is recoverable from context (Vocabulary)

Do NOT write a passage so plain that only one kind of question is possible.
Do NOT include contradictory information — every answer must be determinable from the text with no ambiguity.

─── NATURALNESS ────────────────────────────────────────────────────────────────

- Write the way a fluent native speaker actually writes: natural rhythm, natural word choice.
- A short line of dialogue is fine when it fits.
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

1. Count the words across all paragraphs. Is the total between ${band.min} and ${band.max}?
   - Over ${band.max}? Cut whole sentences that add the least information. Do NOT just trim adjectives.
   - Under ${band.min}? Add one more concrete detail that a question could be asked about.
2. Set "wordCount" to the number you just counted, not an estimate.
3. Is there exactly one central situation, with a clear ending?
4. Could you write a Detail question, a Reason question, and a Vocabulary-in-context question from this passage? If not, add what is missing.
5. Does anything in the passage contradict anything else? Fix it.

─── QUALITY CONSTRAINTS ────────────────────────────────────────────────────────

- Do not invent factual claims about real people, brands, places, or events.
- No sensitive, political, or controversial content unless the topic genuinely requires it.
- Never reproduce source text verbatim. If you draw on something you know, rewrite it completely.
- Content must be appropriate for language learners of any age.
- Readability and questionability matter more than packing in information.

Output JSON only.`;
}
