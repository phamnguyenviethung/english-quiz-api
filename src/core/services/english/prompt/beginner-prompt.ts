import {
  BEGINNER_MAX_OPTION_COUNT,
  isBeginnerLevel,
  type BeginnerEngLevel,
  type EngLevel,
  type QuizType
} from '../questionTypes';
import type { DifficultyContext } from './vocab-prompt';

/**
 * Prompt beginner — dựng CHỒNG lên prompt gốc của từng quizType (không viết lại prompt riêng).
 * Base prompt giữ nguyên hợp đồng chất lượng (schema, distractor sai rõ ràng, self-check…);
 * khối này append cuối, thay cho buildDifficultyInstruction (EXPERT LEARNER MODE) và được
 * phép override mọi rule đẩy độ khó ở phía trên. Xem docs/beginner.md.
 */

// B2 không có bucket beginner — mọi đường đi vào đây với B2 đều bị hạ về B1 (trần beginner).
export function clampBeginnerLevel(level: EngLevel): BeginnerEngLevel {
  return isBeginnerLevel(level) ? level : 'B1';
}

// Mốc theo thang Cambridge English: Pre A1 Starters / A1 Movers / A2 Flyers / A2 Key / B1 Preliminary.
export const BEGINNER_LEVEL_GUIDES: Record<BeginnerEngLevel, string> = {
  A1: 'A1 (≈ Cambridge Starters/Movers) — only the most basic everyday words a young learner meets in the first coursebook units: family, colours, numbers, animals, food, school things, the house, the body, clothes, simple actions (eat, go, play, like, have). Sentences of 5-10 words, present simple / present continuous, "can", "there is/are".',
  A2: 'A2 (≈ Cambridge Flyers / A2 Key) — common words for daily routines, shopping, travel, weather, hobbies, jobs, feelings, places in town. Sentences of up to ~12 words; past simple, "going to", "will", comparatives, "have to", basic phrasal verbs (get up, put on, look for).',
  B1: 'B1 (≈ Cambridge B1 Preliminary) — everyday vocabulary from B1 Preliminary word lists and Cambridge coursebooks: health, the environment in daily life, technology people use at home, school and work life, entertainment, relationships. Sentences of up to ~15 words; present perfect, first conditional, "should", "used to", simple relative clauses. Still NO rare, literary, academic or specialised words.'
};

export const BEGINNER_LEVEL_NOTE: Record<EngLevel, string> = {
  A1: `beginner track, ${BEGINNER_LEVEL_GUIDES.A1}`,
  A2: `beginner track, ${BEGINNER_LEVEL_GUIDES.A2}`,
  B1: `beginner track, ${BEGINNER_LEVEL_GUIDES.B1}`,
  B2: `beginner track capped at B1, ${BEGINNER_LEVEL_GUIDES.B1}`
};

// Thay cho DOMAIN A–G (toàn từ B1–B2) ở vocab/fillblank/synonym/odd-one-out.
export const BEGINNER_VOCAB_DOMAINS = [
  'family & friends',
  'school & classroom',
  'food & drink',
  'home & furniture',
  'clothes',
  'body & health',
  'animals',
  'weather & seasons',
  'transport & places in town',
  'jobs',
  'hobbies & sports',
  'shopping & money',
  'time & daily routine',
  'basic feelings (happy, tired, hungry, bored, worried…)'
] as const;

const BEGINNER_WORD_SELECTION = `BEGINNER WORD SELECTION — replaces "WORD SELECTION — DIVERSITY-FIRST", "DOMAIN ROTATION" and the list of banned/overused words above:
- IGNORE the banned "overused quiz words" list — familiar everyday words (happy, tired, cheap, borrow, kitchen…) ARE allowed and preferred.
- IGNORE DOMAIN A–G and their example words (nostalgic, procrastinate, contemptuous…) — they are far too hard.
- Pick the central word from ONE of these everyday domains, rotating away from domains already used in the exclusion list:
${BEGINNER_VOCAB_DOMAINS.map((domain) => `    • ${domain}`).join('\n')}
- The word must appear in Cambridge English wordlists (Starters/Movers/Flyers, A2 Key, B1 Preliminary) or in the early units of Cambridge coursebooks. If you are not sure a beginner has met it in class, choose a simpler word.`;

const BEGINNER_TYPE_OVERRIDES: Partial<Record<QuizType, string>> = {
  vocab: BEGINNER_WORD_SELECTION,
  fillblank: `${BEGINNER_WORD_SELECTION}
- The sentence around the blank must be short and give ONE obvious everyday clue.`,
  synonym: `${BEGINNER_WORD_SELECTION}
- Synonym/antonym pairs must be textbook pairs a beginner learns together (big/large, start/begin, cheap/expensive, happy/sad) — no subtle register differences.`,
  'odd-one-out': `BEGINNER GROUPS — replaces "DOMAIN ROTATION" above:
- "groupTheme" must be a basic category from a beginner coursebook (fruit, animals, family members, school things, rooms in a house, clothes, weather words, jobs, transport, sports, days/months).
- Every word in the group must be an everyday word; the odd one out must be obviously outside the category once the learner knows the words — no tricky sub-categories.`,
  phrase: `BEGINNER PHRASES:
- Only high-frequency phrases taught in beginner coursebooks: everyday collocations (have breakfast, do homework, make a mistake, take a photo, go shopping), basic phrasal verbs (get up, turn on, look for, put on) and set phrases (at the weekend, on time, in the morning).
- No rare or figurative phrases.`,
  'verb-use-match': `BEGINNER COLLOCATIONS:
- Use the core textbook verbs (make, do, have, take, get, go, play, give, keep, watch) with common nouns from daily life.
- Every option must be a verb a beginner already knows; the correct collocation must be the one taught in coursebooks.`,
  conversation: `BEGINNER DIALOGUE:
- Everyday situations from coursebooks: greetings, ordering food, shopping, asking the way, talking about the weekend, at school, at the doctor.
- Each line is short and natural; the correct reply uses functional language a beginner learns (Would you like…?, How much is…?, Can I…?, Sure, no problem).`,
  description: `BEGINNER DESCRIPTION:
- The answer word must be an everyday word from the domains a beginner learns first (family, food, home, school, animals, clothes, jobs, places in town).
- The clue uses only simple words; never describe a word with harder words than the answer itself.`,
  paragraph: `BEGINNER PARAGRAPH:
- Prefer the SHORT end of the allowed sentence range; every sentence is short (see sentence length for the level) and states one fact directly.
- A simple everyday story (a school day, a family trip, cooking dinner, a birthday party). No abstract or academic content.
- The correct statement is a clear paraphrase of one sentence; wrong statements change one obvious detail (person, time, place, number, action).`,
  idiom: `BEGINNER IDIOMS:
- Only very common idioms that appear in B1 coursebooks and are transparent in context (a piece of cake, break the ice, once in a blue moon). Never obscure or regional idioms.`,
  slang: `BEGINNER SLANG:
- Only mild, widely understood informal words (cool, awesome, kid, guy, hang out). No vulgar, dated, platform-specific or regional slang.`
};

/**
 * Thay buildDifficultyInstruction khi ctx.forBeginner. Append cuối system prompt nên được
 * đặt quyền override rõ ràng — giống cách EXPERT LEARNER MODE override rule distractor.
 */
export function buildBeginnerInstruction(ctx: DifficultyContext, quizType: QuizType): string {
  const level = clampBeginnerLevel(ctx.engLevel);
  const optionCount = Math.min(ctx.optionCount, BEGINNER_MAX_OPTION_COUNT);
  const wrongAnswerCount = optionCount - 1;
  const typeOverride = BEGINNER_TYPE_OVERRIDES[quizType];

  return `

BEGINNER MODE — this block OVERRIDES every conflicting rule above (word selection, domain lists, banned-word lists, difficulty, grammar complexity):
The learner is a Vietnamese BEGINNER. The quiz must feel friendly and achievable, like an exercise from a Cambridge English coursebook.

- Maximum level: B1 (CEFR). Target level for this item: ${level} — ${BEGINNER_LEVEL_GUIDES[level]}
- Vocabulary: ONLY common everyday words people use in daily life and that appear in Cambridge English wordlists (Starters, Movers, Flyers, A2 Key, B1 Preliminary) or Cambridge coursebooks. NEVER use academic, technical, literary, rare or specialised words — not in the question, not in the options, not in the example sentence.
- Grammar: simple, short sentences. NO passive constructions beyond "is made / was built", NO inversion, NO cleft sentences, NO second/third conditionals, NO long participial phrases.
- Options: exactly ${optionCount} options in total — "wrongAnswers" (and every parallel distractor array) must contain EXACTLY ${wrongAnswerCount} items.
- Distractors: plausible and on the same word type, but CLEARLY different in meaning — a beginner who knows the word must be able to rule them out. NO near-synonyms, NO options that differ only by nuance or register.
- Explanations: short, friendly Vietnamese a beginner understands; avoid heavy grammar terminology. Still name the clue in the question that proves the answer.
- Example sentences: everyday situations (home, school, family, friends, shopping, food, hobbies), short and clear.
- If a candidate word is specialised, uncommon, or you are not sure a beginner has learned it — choose a different, more common word.
${typeOverride ? `\n${typeOverride}\n` : ''}`;
}

/** Thay khối LEVEL + VOCABULARY của prompt reading passage khi sinh bài beginner. */
export function buildBeginnerReadingLevelBlock(cefrLevel: EngLevel): string {
  const level = clampBeginnerLevel(cefrLevel);
  return `BEGINNER TRACK — the reader is a Vietnamese beginner (maximum B1). This overrides any conflicting level or vocabulary rule below.
${BEGINNER_LEVEL_GUIDES[level]}

- Write like a reading text from a Cambridge English coursebook for this level: a clear, friendly everyday story.
- Vocabulary: ONLY common everyday words from Cambridge English wordlists (Starters, Movers, Flyers, A2 Key, B1 Preliminary). No academic, technical, literary or rare words. Any "useful target word" must also come from these lists.
- Sentences: short and direct; one idea per sentence. Avoid long clause chains, passive voice and idioms.
- Characters and settings: family, school, friends, neighbours, shops, parks, holidays, hobbies.`;
}

/** Thay buildLevelSection của prompt reading question khi passage là bài beginner. */
export function buildBeginnerReadingQuestionLevelSection(cefrLevel: EngLevel): string {
  const level = clampBeginnerLevel(cefrLevel);
  return `─── LEVEL: ${level} — BEGINNER TRACK (maximum B1) ─────────────────────────────

The learner is a Vietnamese beginner. ${BEGINNER_LEVEL_GUIDES[level]}
The question and all options use only common everyday words (Cambridge English wordlists up to B1 Preliminary) and short, simple sentences — never harder than the passage itself. Distractors must be clearly wrong for a careful beginner reader; no options that differ only by nuance.`;
}
