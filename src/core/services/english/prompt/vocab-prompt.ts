import type { ProviderPreferencesJson } from '@/core/db/schema/main';

export interface DifficultyContext {
  engLevel: 'A1' | 'A2' | 'B1' | 'B2';
  optionCount: 3 | 4 | 5;
  show5050: boolean;
  model: string;
  // Provider routing của model đang dùng (lấy từ ai_models theo context schedule/manual).
  provider?: ProviderPreferencesJson;
  topicName?: string | null;
}

export interface VocabQuestion {
  word: string;
  partOfSpeech: string;
  correctAnswer: string;
  wrongAnswers: string[];
  wrongAnswerExplanations: string[];
  explanation: string;
  exampleSentence: string;
  exampleTranslation: string;
}

const EXAMPLE_WRONG_ANSWERS = [
  'dũng cảm, không sợ hãi trước khó khăn',
  'thân thiện, dễ hòa đồng với mọi người',
  'cẩn thận, chú ý từng chi tiết nhỏ',
  'lười biếng, không muốn làm việc gì'
];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Dũng cảm (brave) nói về việc đối mặt với nguy hiểm dù sợ, còn stubborn là từ chối thay đổi ý kiến — cả hai không có điểm chung dù trong bất kỳ ngữ cảnh nào.',
  'Thân thiện (friendly) mô tả cách đối xử với người khác dễ gần, còn stubborn là tính không chịu nhượng bộ — hai tính cách hoàn toàn độc lập, không liên quan nhau.',
  'Cẩn thận (careful) là chú ý từng chi tiết để tránh sai lầm, còn stubborn là cứng đầu không đổi ý — người cẩn thận hoàn toàn có thể mềm mỏng và linh hoạt.',
  'Lười biếng (lazy) là không muốn cố gắng làm gì, còn stubborn là rất kiên quyết giữ lập trường — thực ra hai tính này thường đối lập nhau về mức độ kiên trì.'
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
Do NOT pick a near-variant (e.g. if "happy" is blocked, "happiness" or "happily" is also off-limits).

`;
}

export function buildVocabPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords ?? [];
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);
  const exclusionBlock = buildExclusionBlock(excludeWords);

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full word selection reasoning for each item separately
  - Each item must pass ALL self-verification checks (wrong answer check, proper noun check, domain rotation, etc.)
  - Each item must have specific, non-abbreviated wrongAnswerExplanations
  - Each item must have a fresh, non-formulaic exampleSentence

UNIQUENESS (in addition to individual quality):
  - No two items share the same central word or concept (including near-variants or morphological forms)
  - No two items share the same exampleSentence structure or scenario setting
  - Vary domain, register, or difficulty angle across items — avoid thematic clusters

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Reusing the same wrong answer candidates across items
  - Using the same sentence structure or setting for multiple exampleSentences
  - Choosing near-synonyms or closely related words as the central "word" across items
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "word": must be a word commonly used in, or strongly associated with, the "${topic}" domain
  - "exampleSentence": must depict a scenario clearly situated in a "${topic}" context
  - "explanation": framing and connotations should reference "${topic}" usage where relevant
DO NOT generate a question where the word is unrelated to "${topic}" and merely rescued by a topic-flavored example sentence. If the word does not naturally belong to "${topic}", choose a different word entirely.
REJECT and restart your selection if you cannot genuinely connect the word to "${topic}" without forcing it.
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';

  // maxOutputTokens guidance: base ~800 tokens * count
  const singleSchema = `{
  "word": string,
  "partOfSpeech": string,
  "correctAnswer": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  const outputInstruction =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] } (no explanation, no markdown):\n${singleSchema}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown):\n${singleSchema}`;

  return `You are an English vocabulary quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
You will freely choose one English word to test, then generate a vocabulary quiz for that word. Do NOT use any external word list — choose the word based entirely on the difficulty context and your own judgment.
${exclusionBlock}
CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${outputInstruction}

Rules:
- "word": the English word you freely chose to test
  - Must be a common English word relevant to daily life
  - Must NOT be a proper noun — this is an ABSOLUTE HARD RULE:
    PROPER NOUN BLOCK: The chosen word must NEVER be a person's name, place name, country name, city name, brand name, product name, or any other proper noun. If you find yourself choosing a word that would normally be capitalized (e.g. "Paris", "Google", "John") — STOP immediately and choose a different word. Only common English words (verbs, adjectives, adverbs, nouns, phrasal verbs) are allowed.
- "partOfSpeech": one of "noun", "verb", "adjective", "adverb", "phrasal verb"
- "correctAnswer": the accurate Vietnamese meaning, concise (5-15 words)
  - Must NOT be a proper noun (no person names, brand names, place names, etc.)
- "wrongAnswers": plausible but ABSOLUTELY INCORRECT Vietnamese meanings — EXACTLY ${wrongAnswerCount} items
  - Same part of speech as the correct answer
  - Similar length and format to the correct answer
  - Sound believable but are completely wrong in ALL senses, ALL contexts, ALL registers
  - Must NOT overlap or be partially correct — not even in one specific usage, dialect, or register
  - Must NOT be synonyms, near-synonyms, or meanings with ANY semantic overlap with the word
  - Must NOT represent any secondary, archaic, or colloquial meaning of the word
  - Must NOT be proper nouns (no person names, brand names, place names, etc.)

  MANDATORY SELF-VERIFICATION — before finalizing each wrong answer, ask yourself:
  "Is there ANY context, register, usage, or interpretation where this Vietnamese meaning
  could be considered correct or even partially correct for this English word?"
  If the answer is YES or MAYBE → discard it and generate a different wrong answer.
  Every wrong answer must pass this check with a definitive NO.

- "wrongAnswerExplanations": for EACH wrong answer, explain in 1 sentence (friendly Vietnamese) WHY it is absolutely wrong — EXACTLY ${wrongAnswerCount} items
  - Same count and order as wrongAnswers
  - Required format: "[Nghĩa X] nói về [mô tả của X], còn [từ đúng] nói về [mô tả đúng] — [lý do cụ thể hai ý này không thể trùng nhau]."
  - Must clearly state WHAT the wrong answer describes AND WHY that cannot apply to this word
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "explanation": 1-2 sentences in friendly Vietnamese
  - Sentence 1: state the CORE meaning with key nuance (connotation, register, typical context this word appears in)
  - Sentence 2 (optional): mention what this word is commonly confused with and the key difference
  - Do NOT include an example sentence here
  - Do NOT use markdown formatting (no **bold**, no *italic*)
  - Keep it casual and easy to understand
- "exampleSentence": one natural English sentence using the word in context
  - Should reflect authentic, daily-life usage (e.g. conversations, school, work, shopping, relationships, health, hobbies)
  - Even if the word is technical or uncommon, use it in a relatable everyday scenario
  - Must NOT be the same sentence used in the quiz question
- "exampleTranslation": natural Vietnamese translation of exampleSentence
  - Must be accurate and natural, not word-for-word literal

PROPER NOUN PROHIBITION (repeated for emphasis):
- The quiz question, correctAnswer, and ALL wrongAnswers must NEVER consist entirely of proper nouns (person names, brand names, place names, organization names, etc.)
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
- Always prefer example sentences and explanations that relate to daily life (conversations with friends, family, school, work, shopping, cooking, health, hobbies, social media, travel, etc.)
- Even if the word is academic or specialized, frame the example in a scenario a Vietnamese learner would encounter in their everyday life.

Example output (with exactly ${wrongAnswerCount} wrong answers)${count > 1 ? ` — showing 1 of ${count} items in the "questions" array` : ''}:
${count > 1 ? `{ "questions": [` : ''}
{
  "word": "stubborn",
  "partOfSpeech": "adjective",
  "correctAnswer": "bướng bỉnh, không chịu thay đổi ý kiến",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "Stubborn nghĩa là bướng bỉnh — người cứ giữ nguyên ý kiến dù bị thuyết phục thế nào cũng không đổi, thường mang sắc thái tiêu cực nhưng đôi khi được dùng theo nghĩa tích cực (kiên định). Khác với 'determined' (quyết tâm vì lý do chính đáng), stubborn thường hàm ý vô lý, không có căn cứ.",
  "exampleSentence": "He's so stubborn that he refused to see a doctor even when he was sick.",
  "exampleTranslation": "Anh ta bướng đến mức bệnh mà cũng không chịu đi khám."
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
