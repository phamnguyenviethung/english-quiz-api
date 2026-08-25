import { type EngLevel } from '../questionTypes';

// Academic variant của reading-passage-prompt.ts — bản duplicate, sửa lại cho văn phong
// expository/informational thay vì narrative. Chủ đề (topicName) vẫn là input y hệt bản
// daily; toàn bộ phần còn lại (chủ đề được PHÉP academic, văn phong, cấu trúc, từ vựng)
// được viết lại cho phù hợp bài đọc academic. Sửa guideline academic thì sửa cả file này.

export interface ReadingPassage {
  title: string;
  paragraphs: string[];
  wordCount: number;
  topic: string;
  cefrLevel: EngLevel;
}

/** Giữ cùng band với bản daily cho iteration này — tách const riêng để sau này tách được. */
export const ACADEMIC_READING_WORD_BAND = { min: 150, max: 220 } as const;

export const ACADEMIC_READING_WORD_ACCEPT = { min: 140, max: 235 } as const;

// Độ dài giống nhau ở mọi level nên level CHỈ được thể hiện qua từ vựng, độ phức tạp câu
// và cách triển khai ý — duplicate y hệt bản daily, style-agnostic.
const LEVEL_GUIDES: Record<EngLevel, string> = {
  A1: 'Very common everyday words only. Short simple sentences, mostly present tense. Avoid embedded clauses and phrasal verbs beyond the most basic ones. Grammar complexity must stay low.',
  A2: 'Common everyday vocabulary plus a few useful new words. Simple and compound sentences; past and future tenses are fine. Keep clause chains short.',
  B1: 'Intermediate vocabulary including some useful collocations. Compound and complex sentences in moderation; connectors and fuller description are fine, but keep the explanation easy to follow.',
  B2: 'Natural vocabulary including idiomatic expressions where they fit. More complex structures (relative clauses, conditionals, passive) and more varied sentence patterns are allowed, but the writing must still read smoothly.'
};

/** Target mix của question points — passage phải đỡ được 5-7 điểm này. */
export const QUESTION_POINT_TARGETS = [
  '2-3 explicit details — facts stated outright in the text',
  '1 reason / mechanism — why or how something happens',
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
  - Its own single central idea/phenomenon, its own 5-7 information points, its own Overview → Explanation → Significance arc
  - Its own word count inside the required band
  - Its own title

UNIQUENESS across the batch:
  - No two passages explain the same sub-topic the same way
  - No two passages open with the same sentence pattern
  - Vary the specific angle, process, example or case covered under the topic
  - Vary the takeaway (a mechanism explained, a comparison drawn, a cause traced, a consequence highlighted)

COMMON BATCH FAILURES — avoid:
  - Writing passage 1 carefully then rushing the rest
  - Reusing the same "here is a fact, here is why it matters" shape across items
  - Drifting outside the word band on later items
  - Letting later passages thin out until only detail questions could be asked about them
`;
}

function buildExcludeInstruction(excludeTitles: string[]): string {
  if (excludeTitles.length === 0) return '';
  const list = excludeTitles.map((title) => `  - ${title}`).join('\n');
  return `
ALREADY USED — do NOT repeat these angles:
These passages already exist for this topic and level. Write something clearly different:
${list}

Different means: a different sub-topic, a different angle or example, and a different takeaway — not the same explanation with new wording.
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

export function buildAcademicReadingPassagePrompt(input: {
  topicName: string;
  cefrLevel: EngLevel;
  count?: number;
  excludeTitles?: string[];
}): string {
  const { topicName, cefrLevel } = input;
  const count = input.count ?? 1;
  const { min, max } = ACADEMIC_READING_WORD_BAND;

  return `You are an academic reading-passage writer for Vietnamese learners of English.

Your job is to write short expository "micro-readings" — factual, informational texts (in the style of an encyclopedia entry, a textbook excerpt, or a short science/history magazine piece) that a learner should finish in about 10 minutes, including looking up a few words. Each passage will later be turned into 3 comprehension questions by a SEPARATE pipeline. You do not write questions.
${buildBatchInstruction(count)}${buildExcludeInstruction(input.excludeTitles ?? [])}
─── TOPIC LOCK — "${topicName}" ────────────────────────────────────────────────

This is a HARD CONSTRAINT, not a suggestion. The passage must be an informational, academic-style treatment of the "${topicName}" domain — a reader should immediately recognise it as explaining or exploring "${topicName}".

- Treat the topic with real explanatory depth: explain a phenomenon, a process, a historical event, a scientific idea, a social or technical concept — whatever "${topicName}" naturally calls for.
- Prefer general, well-established, uncontroversial facts. Do NOT invent specific statistics, dates, named studies, or named real researchers/institutions — when specifics would normally be cited, use safe general phrasing instead ("scientists have found that...", "over time, this became common practice...").
- Fictional narrative, personal stories, and dialogue are NOT appropriate here — this is expository, not narrative, writing.
- The reader must not need any outside knowledge to understand the passage.

─── LEVEL: ${cefrLevel} ──────────────────────────────────────────────────────────

${LEVEL_GUIDES[cefrLevel]}

Every level uses the SAME length. The level must show through vocabulary, sentence complexity and how ideas are connected — NEVER through how long the passage is. Do not stretch sentences at a low level to fill space, and do not compress a high level into simple ones.

Length: ${min}-${max} words total, across all paragraphs — this applies to every CEFR level.
- Do NOT pad the passage to reach the word count. A tight ${min}-word passage beats a padded ${max}-word one.
- Do NOT add sentences that carry no information.

${buildSchemaBlock(count, cefrLevel, topicName)}

─── STRUCTURE ──────────────────────────────────────────────────────────────────

Exactly ONE central idea or phenomenon per passage, explained in 3-4 paragraphs following this arc:
  1. Overview — what the topic/phenomenon is, why it matters or comes up
  2. Explanation — how or why it works, happens, or came to be; the mechanism, process, causes, or key facts
  3. Significance — what it means, its effect, or why it is worth knowing

Include 5-7 meaningful information points — a fact, a cause, a process step, a comparison, a consequence, a definition, a notable detail. Every one must connect logically to the others; no loose trivia dropped in.

- Spread the information across the passage. Do NOT pack the useful facts into one sentence and leave the rest empty.
- Every paragraph must contribute at least one piece of meaningful information.
- Favour concrete facts, mechanisms, causes and effects over vague generalities.
- The passage must be self-contained: everything needed to understand it is inside it.

"title": a short natural title (3-8 words) for the passage — informative, not a question, not clickbait.
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
- Reason / cause-effect: the causal or mechanical link between cause and effect, or process and result, must be visible in the text.
- Vocabulary in context: the surrounding sentences must give enough clues to work out the meaning.
- Nothing may depend on outside knowledge, an unevidenced opinion, or information you did not write down.

─── VOCABULARY ─────────────────────────────────────────────────────────────────

- Most words should already be familiar at ${cefrLevel}; a few useful new ones are fine.
- Academic and topic-specific vocabulary IS expected and welcome here — this is the point of an academic passage. Introduce technical terms naturally and make their meaning recoverable from context.
- Include 1-3 useful target words (can be topic-specific or academic terms) whose meaning is recoverable from context.
- Do NOT stuff hard words in just to create vocabulary questions.
- Target words must not be obscure jargon with no context support, must not have several meanings that fit equally well here, and must never be proper nouns.

─── DISTRACTOR READINESS ───────────────────────────────────────────────────────

The question pipeline may build multiple-choice options, so the passage should contain enough real material to draw wrong-but-tempting options from:
  - a second cause or factor of the same kind (right effect, wrong cause)
  - a second point in time or stage of the process (right fact, wrong moment)
  - a second comparable example or case that is not the one being discussed

But do NOT let two facts sit so close together that a wrong option could also be read as correct. Each fact must be clearly attached to its own cause, time and outcome.

─── AMBIGUITY PREVENTION ───────────────────────────────────────────────────────

- Every pronoun must have one obvious antecedent. "they", "it", "this", "that" must never be guessable in two ways.
- Never let two entities or processes both plausibly be the subject of the same effect.
- When the order of steps or events matters, make it unmistakable.
- Keep cause and result clearly distinguishable from each other.
- Do not use wording that supports two reasonable interpretations, and do not contradict yourself anywhere in the passage.

─── NATURALNESS ────────────────────────────────────────────────────────────────

- Write like a well-edited educational text: clear, precise, engaging without being casual.
- Avoid textbook-cliché filler ("Today I will tell you about...", "In conclusion...").
- Avoid the flat, over-explained register that makes text feel machine-written.
- A genuinely interesting or surprising fact is welcome to keep it engaging.

─── VARIETY ────────────────────────────────────────────────────────────────────

Do NOT open with these tired shapes:
  "Have you ever wondered ..." / "Did you know that ..." / "${topicName} is a topic that ..."

Vary the angle, sub-topic, opening hook, and framing between passages. Some passages should explain a process, some a cause-and-effect relationship, some a comparison, some a historical development.

─── DO NOT WRITE QUESTIONS ─────────────────────────────────────────────────────

Output the passage only. No questions, no answer options, no vocabulary list, no translation, no teaching notes. Question generation is a separate step.

─── FINAL SELF-CHECK — before you output ───────────────────────────────────────

1. Count the words across all paragraphs. Is the total between ${min} and ${max}?
   - Over ${max}? Cut whole sentences that add the least information. Do NOT just trim adjectives.
   - Under ${min}? Add one more concrete detail that a question could be asked about.
2. Set "wordCount" to the number you just counted, not an estimate.
3. Are there 5-7 meaningful information points, spread across the paragraphs rather than bunched into one?
4. Pick 3 DIFFERENT information points and check you could write one question on each — of at least two different kinds — answerable from the text alone, in any order.
5. Does every pronoun point to exactly one thing? Could any sentence be read two ways? Fix it.
6. Does anything in the passage contradict anything else? Fix it.

─── QUALITY CONSTRAINTS ────────────────────────────────────────────────────────

- Stick to general, well-established, textbook-level facts. Do NOT invent specific statistics, dates, named studies, or named real people, brands, or institutions.
- No sensitive, political, or controversial content unless the topic genuinely and unavoidably requires it — and even then, stay neutral and factual.
- Never reproduce source text verbatim. If you draw on something you know, rewrite it completely in your own words.
- Content must be appropriate for language learners of any age.
- Accuracy and questionability matter more than packing in information — do not sacrifice factual soundness for density.

Output JSON only.`;
}
