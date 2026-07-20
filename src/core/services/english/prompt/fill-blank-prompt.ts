export interface FillBlankQuestion {
  word: string;
  sentence: string;
  sentenceTranslation: string;
  highlightedWord: string;
  correctAnswer: string;
  correctAnswerTranslation: string;
  wrongAnswers: string[];
  optionTranslations: string[];
  wrongAnswerExplanations: string[];
  explanation: string;
  exampleSentence: string;
  exampleTranslation: string;
}

const EXAMPLE_WRONG_ANSWERS = ['evaporate', 'collapse', 'overflow', 'surge'];
const EXAMPLE_OPTION_TRANSLATIONS = ['bốc hơi', 'sụp đổ', 'tràn ngập', 'tăng vọt'];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Evaporate (bốc hơi) diễn tả sự biến mất hoàn toàn và nhanh chóng, nhưng trong câu này "slowly... leaving little more than mud" chỉ rõ quá trình giảm dần từng chút — dwindle mới diễn tả đúng sự hao mòn từ từ chứ không biến mất đột ngột.',
  'Collapse (sụp đổ) mang nghĩa đổ vỡ hoàn toàn đột ngột, nhưng câu này có "slowly" và "over the dry season" cho thấy quá trình kéo dài nhiều tháng — dwindle mới phù hợp với nhịp độ chậm rãi đó.',
  'Overflow (tràn ngập) là tăng quá mức và tràn ra ngoài — nghĩa hoàn toàn ngược chiều với câu này vì con sông đang CẠN DẦN, không phải dâng lên.',
  'Surge (tăng vọt) diễn tả sự tăng nhanh đột ngột — ngược hoàn toàn với ngữ cảnh câu này, nơi con sông đang mất nước dần đến mức "little more than mud".'
];

function buildExclusionBlock(excludeWords: string[]): string {
  if (excludeWords.length === 0) return '';
  const list = excludeWords.map((w, i) => `  ${i + 1}. "${w}"`).join('\n');
  return `
WORD EXCLUSION — ABSOLUTE HARD BLOCK:
The following words have been used recently and are FORBIDDEN as the "word" field:
${list}
Using any word from this list is a critical failure — the quiz will be discarded.
Before writing the "word" field, mentally check: "Is this word in the forbidden list?" → If YES or SIMILAR → choose again.
Do NOT pick a near-variant (e.g. if "dwindle" is blocked, "dwindling" is also off-limits).

`;
}

export function buildFillBlankPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords ?? [];
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const optionTranslations = EXAMPLE_OPTION_TRANSLATIONS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);
  const exclusionBlock = buildExclusionBlock(excludeWords);

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full word selection and context-lock reasoning for each item separately
  - Each item must pass ALL self-verification checks (context-lock self-test, context verification, proper noun check, etc.)
  - Each item must have specific wrongAnswerExplanations that reference THIS item's sentence context — not generic explanations
  - Each item must have a fresh exampleSentence in a different daily-life scenario

UNIQUENESS (in addition to individual quality):
  - No two items share the same central word or concept (including near-variants)
  - No two items share the same sentence setting or scenario type
  - Vary domain, sentence structure, and context clue type across items

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Reusing sentence structures or context patterns across items
  - Using the same wrong answer candidates across items
  - Choosing near-synonyms as the central word across items
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "word": must be a word commonly used in, or strongly associated with, the "${topic}" domain
  - "sentence": the fill-in-the-blank sentence must depict a scenario set in a "${topic}" context
  - "exampleSentence": must also depict a scenario in a "${topic}" context
DO NOT generate a question where the word is unrelated to "${topic}" and merely rescued by a topic-flavored sentence wrapper. If the word does not naturally belong to "${topic}", choose a different word entirely.
REJECT and restart your selection if you cannot genuinely connect both the word and its sentence context to "${topic}" without forcing it.
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';

  // maxOutputTokens guidance: base ~1000 tokens * count
  const singleSchema = `{
  "word": string,
  "sentence": string,
  "sentenceTranslation": string,
  "highlightedWord": string,
  "correctAnswer": string,
  "correctAnswerTranslation": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "optionTranslations": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  const outputInstruction =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] } (no explanation, no markdown):\n${singleSchema}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown):\n${singleSchema}`;

  return `You are an English fill-in-the-blank quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
You will freely choose one English word, then create a fill-in-the-blank question using that word. Do NOT use any external word list — choose the word based entirely on the difficulty context and your own judgment.
${exclusionBlock}
CRITICAL: "wrongAnswers", "optionTranslations", and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${outputInstruction}

Rules:
- "word": the English word you freely chose to test
  - Must be a common English word relevant to daily life
  - Must NOT be a proper noun — this is an ABSOLUTE HARD RULE:
    PROPER NOUN BLOCK: The chosen word must NEVER be a person's name, place name, country name, city name, brand name, product name, or any other proper noun. If you find yourself choosing a word that would normally be capitalized (e.g. "Paris", "Google", "John") — STOP immediately and choose a different word. Only common English words (verbs, adjectives, adverbs, nouns, phrasal verbs) are allowed.
- "sentence": a natural English sentence where the word is replaced by "___"

  CONTEXT-LOCK REQUIREMENT — the sentence MUST contain enough specificity so that ONLY the correct word fits:
  - Include at least ONE of the following to narrow down the answer:
    (a) a temporal/manner marker that reveals the nature of the process (e.g. "slowly", "overnight", "over months", "in an instant")
    (b) a result or consequence clause that reveals the direction or outcome (e.g. "leaving nothing behind", "until it was gone", "allowing us to...")
    (c) a subject or object whose characteristics rule out near-synonyms
    (d) a strong collocate that the correct word exclusively or primarily pairs with
  - Generic sentences where 2 or more near-synonyms would all sound natural are NOT acceptable
  - SELF-TEST before finalizing: "If I substituted ___ with each of my wrong answer candidates, would the sentence become clearly unnatural or semantically wrong?" → must be YES for every wrong answer
  - Do NOT make the answer immediately obvious — the context should narrow it down to one, not give it away

- "correctAnswer": must be exactly the word you chose (same form/tense as it would appear in the sentence)
- "wrongAnswers": plausible but DEFINITIVELY INCORRECT English words for THIS SPECIFIC SENTENCE — EXACTLY ${wrongAnswerCount} items
  - Must be real English words of the same part of speech
  - Must be grammatically valid in the sentence position
  - Must be WRONG specifically within this sentence's context — not just wrong in theory
  - Challenge comes from: collocational mismatch with the sentence's key elements, semantic conflict with the subject/object/result, or register incompatibility visible in this sentence
  - Do NOT include words that would be acceptable, near-acceptable, or even slightly ambiguous in this sentence
  - Must NOT be proper nouns (no person names, brand names, place names, etc.)

  MANDATORY CONTEXT VERIFICATION — for each wrong answer candidate, check:
  "If I put [wrongWord] in this sentence, does the sentence become clearly unnatural or semantically
  wrong in a way I can explain specifically using elements of THIS sentence?"
  If NO or UNSURE → reject that candidate and choose a different one.
  Only proceed with wrong answers where the answer is YES with a clear, sentence-specific reason.

- "sentenceTranslation": the full Vietnamese translation of the sentence with the correct word filled in (not "___")
  - Must be natural, accurate Vietnamese — not word-for-word literal
- "highlightedWord": the exact Vietnamese word or short phrase in sentenceTranslation that directly corresponds to correctAnswer
  - Must be a substring that appears verbatim in sentenceTranslation
  - Should be as short as possible — ideally a single word or 2-3 word phrase
- "correctAnswerTranslation": Vietnamese meaning of correctAnswer — concise (1-5 words), just the core meaning
- "optionTranslations": Vietnamese meanings for each item in wrongAnswers, in the same order — EXACTLY ${wrongAnswerCount} items
  - Each translation should be concise (1-5 words), just the core meaning
- "wrongAnswerExplanations": for EACH wrong answer, explain in 1 sentence (friendly Vietnamese) WHY it is wrong IN THIS SPECIFIC SENTENCE — EXACTLY ${wrongAnswerCount} items
  - Same count and order as wrongAnswers
  - MUST reference the specific context of this sentence — not just general meaning differences
  - Required format: "[Từ X] có nghĩa [Y], nhưng trong câu này [yếu tố cụ thể trong câu] cho thấy [đặc điểm của từ đúng] — [từ X] không diễn tả được điều đó."
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "explanation": 1-2 sentences in friendly Vietnamese explaining why the correct word fits this sentence
  - Explain specifically what element(s) in the sentence confirm this word choice
  - Do NOT include an example sentence here
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "exampleSentence": a DIFFERENT natural English sentence using the word (not the quiz sentence)
  - Should show another common, daily-life usage context
  - Even if the word is academic or specialized, use it in a relatable everyday scenario
- "exampleTranslation": natural Vietnamese translation of exampleSentence

PROPER NOUN PROHIBITION (repeated for emphasis):
- The quiz sentence, correctAnswer, and ALL wrongAnswers must NEVER consist entirely of proper nouns (person names, brand names, place names, organization names, etc.)
- If you accidentally think of a proper noun — discard it immediately and pick a common word instead.

WORD SELECTION — DIVERSITY-FIRST SYSTEM:

You MUST NOT default to overused quiz words like: happy, sad, angry, brave, honest, kind, shy, rude, calm, smart, fast, slow, big, small, give, take, love, hate, help, hurt. These are banned even if not in the exclusion list.

DOMAIN ROTATION — select a word from the domain LEAST represented in the recent exclusion list. Pick from ONE of these domains:
  DOMAIN A — Emotions & mental states: nostalgic, anxious, elated, envious, bewildered, contemptuous, melancholic, apprehensive, exasperated, serene, remorseful, indignant
  DOMAIN B — Personality & character traits: stubborn, manipulative, conceited, reckless, compassionate, pretentious, reliable, arrogant, impulsive, diligent, obnoxious, timid
  DOMAIN C — Social behavior & relationships: flatter, betray, reconcile, alienate, confront, console, persuade, offend, neglect, appreciate, impress, isolate
  DOMAIN D — Physical appearance & sensory: slender, coarse, vibrant, dull, gleaming, crooked, fragile, rigid, transparent, murky, pale, bulky
  DOMAIN E — Work, effort & achievement: strive, procrastinate, persevere, abandon, accomplish, undermine, delegate, overwhelm, motivate, excel, resign, commit
  DOMAIN F — Moral & ethical judgment: deceive, justify, condemn, forgive, exploit, corrupt, repent, tolerate, criticize, endure, honor, defy
  DOMAIN G — Communication & expression: boast, whisper, argue, complain, exaggerate, confess, persuade, deny, mock, flatter, reassure, misinterpret

Selection process:
1. Look at the excluded words list → identify which domains they belong to.
2. Choose the domain with ZERO or fewest recent words.
3. From that domain, pick a word that is less commonly seen in quizzes — NOT the first word that comes to mind.
4. Prefer words: not so simple a child knows them, not so rare they require a dictionary.
5. FINAL CHECK before writing: "Is this word a proper noun?" → If YES → go back to step 3.

IMPORTANT — Daily-life relevance:
- Always prefer sentences and explanations that relate to daily life (conversations with friends, family, school, work, shopping, cooking, health, hobbies, social media, travel, etc.)
- Even if the word is academic or specialized, frame the sentence in a scenario a Vietnamese learner would encounter in their everyday life.

Example output (with exactly ${wrongAnswerCount} wrong answers)${count > 1 ? ` — showing 1 of ${count} items in the "questions" array` : ''}:
${count > 1 ? `{ "questions": [` : ''}
{
  "word": "dwindle",
  "sentence": "The river had been slowly ___ over the dry season, leaving little more than mud by August.",
  "sentenceTranslation": "Con sông đã dần cạn kiệt suốt mùa khô, chỉ còn lại bùn vào tháng Tám.",
  "highlightedWord": "dần cạn kiệt",
  "correctAnswer": "dwindling",
  "correctAnswerTranslation": "dần cạn kiệt",
  "wrongAnswers": ${JSON.stringify(wrongAnswers)},
  "optionTranslations": ${JSON.stringify(optionTranslations)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "Dwindle diễn tả quá trình giảm dần từng chút một cho đến khi gần cạn kiệt hoàn toàn — câu này dùng 'slowly' và 'leaving little more than mud' xác nhận đây là sự hao mòn chậm rãi theo thời gian, đúng với nghĩa của dwindle.",
  "exampleSentence": "Her enthusiasm began to dwindle as the project dragged on for months.",
  "exampleTranslation": "Sự nhiệt tình của cô ấy dần tàn lụi khi dự án kéo dài mãi không xong."
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
