export type VerbUseMatchFormat = 'fill-blank' | 'phrase-choice';

export interface VerbUseMatchQuestion {
  format: VerbUseMatchFormat; // loại format để handler render đúng
  targetPhrase: string; // collocation đúng, VD: "make a decision"
  verb: string; // chỉ phần verb, VD: "make"
  noun: string; // chỉ phần noun/object, VD: "a decision"
  sentence: string; // câu fill-blank (có ___) khi format=fill-blank, hoặc question stem khi format=phrase-choice
  wrongAnswers: string[]; // Exactly optionCount-1 items — verbs sai (fill-blank) hoặc full phrases sai (phrase-choice)
  wrongAnswerExplanations: string[]; // Same count as wrongAnswers
  explanation: string; // 1-2 câu tiếng Việt về collocation, không chứa ví dụ, không markdown
  exampleSentence: string; // câu ví dụ tự nhiên dùng targetPhrase
  exampleTranslation: string; // Vietnamese translation
}

const EXAMPLE_WRONG_ANSWERS_FILL_BLANK = ['do', 'build', 'create', 'take'];
const EXAMPLE_WRONG_ANSWERS_PHRASE_CHOICE = [
  'do a decision',
  'build a decision',
  'create a decision',
  'take a decision'
];
const EXAMPLE_WRONG_EXPLANATIONS = [
  '"Do" thường đi với các hoạt động như homework, exercise, work — còn với "a decision", người bản xứ luôn dùng "make", không phải "do".',
  '"Build" nói về việc xây dựng vật lý hoặc phát triển dần dần — còn "a decision" là kết quả của suy nghĩ tức thời, không phải quy trình xây dựng.',
  '"Create" mang nghĩa sáng tạo ra thứ gì mới — còn việc đưa ra quyết định là chọn lựa trong các lựa chọn đã có, không phải sáng tạo.',
  '"Take a decision" nghe như tiếng Anh British nhưng không phải mainstream American usage — "make a decision" mới là collocation chuẩn và phổ biến nhất.'
];

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Everyday life & routines',
  2: 'Work & productivity',
  3: 'Emotions & mental states',
  4: 'Social & relationships',
  5: 'Time & urgency',
  6: 'Problem-solving & decisions'
};

function buildExclusionBlock(excludePhrases: string[]): string {
  if (excludePhrases.length === 0) return '';

  const list = excludePhrases.map((p, i) => `  ${i + 1}. "${p}"`).join('\n');

  return `
════════════════════════════════════════════════════
  FORBIDDEN COLLOCATIONS — ABSOLUTE HARD BLOCK
════════════════════════════════════════════════════
  The ${excludePhrases.length} collocation(s) below MUST NOT appear as the "targetPhrase" field.
  Violating this block = the entire response is discarded and regenerated.

${list}

  MANDATORY PRE-OUTPUT CHECKLIST (answer internally before writing JSON):
  ✔ Q1: Is my chosen targetPhrase listed above? → YES = pick a different collocation, NO = continue
  ✔ Q2: Is my chosen targetPhrase a variant or near-equivalent of any forbidden collocation?
         (e.g. if "make a decision" is blocked, "make decisions" is also blocked) → YES = pick again, NO = continue
  Only proceed to output if Q1=NO and Q2=NO.
════════════════════════════════════════════════════
`;
}

export function buildVerbUseMatchPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords ?? [];

  const wrongAnswersFillBlank = EXAMPLE_WRONG_ANSWERS_FILL_BLANK.slice(0, wrongAnswerCount);
  const wrongAnswersPhraseChoice = EXAMPLE_WRONG_ANSWERS_PHRASE_CHOICE.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);

  const exclusionBlock = buildExclusionBlock(excludeWords);

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full collocation selection and self-verification for each item separately
  - Each item must pass the forbidden collocation checklist independently
  - Each item must have specific wrongAnswerExplanations explaining the exact semantic conflict
  - Each item must have a fresh, authentic exampleSentence in a different real-life context

UNIQUENESS (in addition to individual quality):
  - No two items share the same targetPhrase or any variant of it
  - No two items share the same exampleSentence scenario or context
  - No two items share the same verb family in the correct answer (e.g. don't use "make" twice)
  - Vary format across items — mix "fill-blank" and "phrase-choice", do NOT use the same format for all items
  - Vary categories across items — do not cluster in the same domain

COMMON BATCH FAILURES — avoid:
  - Choosing collocations from the same verb family repeatedly (make/make/make)
  - Reusing the same wrong verb candidates across items
  - Using the same difficulty level for all items
  - Writing textbook-style exampleSentences ("He made a decision at the meeting")
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "targetPhrase": must be a verb+noun collocation commonly used in, or naturally applicable to, "${topic}" situations
  - "exampleSentence": must depict a scenario clearly situated in a "${topic}" context
DO NOT generate a question where the collocation is forced into the topic through an unnatural example sentence. If the collocation does not organically connect to "${topic}", choose a different collocation entirely.
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint.
`
    : '';

  const singleSchema = `{
  "format": "fill-blank" | "phrase-choice",
  "targetPhrase": string,
  "verb": string,
  "noun": string,
  "sentence": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  const outputInstruction =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] } (no explanation, no markdown, no code fences):\n${singleSchema}`
      : `Return ONLY valid JSON (no explanation, no markdown, no code fences):\n${singleSchema}`;

  const categoryRotationBlock = Object.entries(CATEGORY_NAMES)
    .map(([num, name]) => `  CAT ${num} — ${name}`)
    .join('\n');

  return `You are a verb collocation quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
GENERATION SOURCE — MANDATORY:
Your collocation MUST come entirely from your own internalized knowledge of natural English. The categories, verb families, and examples below are guides for diversity — they are NOT word banks. Do NOT:
  - Use any collocation named anywhere in this prompt (forbidden list, schema labels, example output, or anywhere else)
  - Default to the most famous or textbook-obvious collocation for any given domain
  - Repeat the same verb family across questions in a batch (make/make/make is wrong)

The goal is to surface collocations that are genuinely useful for Vietnamese learners — natural phrases that feel obvious to native speakers but are non-obvious for Vietnamese learners who translate literally.
${exclusionBlock}
CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${outputInstruction}

QUIZ FORMAT RULES:
Choose one of two formats per question. Rotate across formats — do not always pick the same one.

FORMAT A — "fill-blank":
  - "sentence": a natural English sentence with ___ replacing the verb only (e.g. "She ___ a mistake and apologized.")
  - "wrongAnswers": exactly ${wrongAnswerCount} other verbs that are DEFINITIVELY unnatural with this noun (e.g. ["do", "build", "create"])
  - The learner picks which verb goes in the blank
  - "sentence" MUST contain exactly the string "___" when format is "fill-blank"

FORMAT B — "phrase-choice":
  - "sentence": the question stem, e.g. "Which phrase sounds most natural?"
  - "wrongAnswers": exactly ${wrongAnswerCount} full phrases using wrong verbs + same noun (e.g. ["do homework", "build homework"])
  - The learner picks which full phrase sounds natural
  - Do NOT include a "___ " blank in the sentence for this format

FIELD RULES:
- "targetPhrase": the correct collocation as a full phrase — e.g. "make a decision", "pay attention", "catch a cold"
  - Must be a verb + noun (or verb + noun phrase) collocation
  - Must be used in modern everyday American English (conversational, work, or social contexts)
  - Must NOT be a proper noun or contain a proper noun
  - Must NOT be a phrasal verb (no separable/inseparable particle verbs) — focus on verb + noun collocations only
  - ABSOLUTE RULE: must NOT match or paraphrase any string named in this prompt

- "verb": only the verb part of targetPhrase (e.g. "make")
- "noun": only the noun part of targetPhrase (e.g. "a decision")

- "wrongAnswers": EXACTLY ${wrongAnswerCount} items — verbs (fill-blank) or full phrases (phrase-choice)
  - Each wrong option must be DEFINITIVELY unnatural with this specific noun/context
  - Must NOT be a partially acceptable or dialectally acceptable alternative
  - Must NOT be a paraphrase of the correct answer
  - Each wrong verb must be drawn from a realistic "confusion zone" — verbs that learners commonly mix up (make/do/take/give/have/run/keep/catch/pay/raise/bring...)
  - All wrong verbs must be from the SAME grammatical register as the correct verb (no mixing formal/informal)

  MANDATORY AMBIGUITY GUARD — before finalizing the full set, ask:
  "Is there any mainstream English context where more than one option sounds natural with this exact noun/situation?"
  → YES = change the noun/situation or redesign the verb set entirely
  "Is this collocation universally accepted in mainstream American English as the only natural choice?"
  → NO = find a less ambiguous collocation

- "wrongAnswerExplanations": EXACTLY ${wrongAnswerCount} items, same order as wrongAnswers. 1 friendly Vietnamese sentence each.
  Required format: "[Verb X / Phrase X] thường đi với [other context], còn '[targetPhrase]' mới là cách người bản xứ nói — vì [specific reason]."
  Must state a concrete conflict — not just "nghĩa khác nhau". No markdown.

- "explanation": 1-2 casual Vietnamese sentences
  - Sentence 1: why this specific verb + noun sounds natural (the "feel" of the collocation, not a grammar rule)
  - Sentence 2 (optional): a memory tip, common Vietnamese mistake, or real-life usage note
  - Do NOT include an example sentence here. Do NOT use markdown.

- "exampleSentence": natural English sentence using the targetPhrase verbatim
  - Must feel authentic — not textbook-formal, not contrived
  - The targetPhrase must appear verbatim in the sentence

- "exampleTranslation": natural Vietnamese translation of exampleSentence (not word-for-word literal)

SELF-VERIFICATION — answer internally before writing JSON:
  ✔ Q1: Is there any mainstream English context where more than one option sounds natural with this exact noun/situation? → YES = change the noun/situation or redesign the verb set
  ✔ Q2: Could a learner reasonably argue that any wrong answer is acceptable? → YES = reject that wrong answer and replace
  ✔ Q3: Is the correct collocation clearly the most natural choice for a native speaker? → NO = change the target phrase
  ✔ Q4: Are all wrong verbs definitively unnatural with this noun in this context (not just less common, but actually wrong)? → any NO = replace
  ✔ Q5: Does "sentence" contain exactly "___" when format is "fill-blank"? → NO = fix
  ✔ Q6: Is the targetPhrase listed in the exclusion block above? → YES = pick a different collocation
  ✔ Q7: Are wrongAnswers and wrongAnswerExplanations both exactly ${wrongAnswerCount} items? → NO = fix counts
  Only output JSON if ALL checks pass.

CATEGORY ROTATION — rotate across these 6 domains to ensure diversity:
${categoryRotationBlock}

Selection process:
1. Look at the forbidden list above (if any) — consider which verb families and domains are already covered.
2. Pick a domain and verb family NOT well-represented in the recent forbidden list.
3. From that domain, choose a collocation from your own internalized knowledge — not the most obvious one, not named anywhere in this prompt.
4. Apply the ambiguity guard before finalizing your choice.

Output format reference (${wrongAnswerCount} wrong answers, format=fill-blank example)${count > 1 ? ` — repeat for each of the ${count} items in the "questions" array` : ''}:
${count > 1 ? '{ "questions": [' : ''}
{
  "format": "fill-blank",
  "targetPhrase": "<correct collocation — not from this prompt>",
  "verb": "<verb only>",
  "noun": "<noun/object only>",
  "sentence": "<natural sentence with ___ replacing the verb>",
  "wrongAnswers": ${JSON.stringify(wrongAnswersFillBlank, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "<1–2 casual Vietnamese sentences: why this verb+noun sounds natural>",
  "exampleSentence": "<authentic English sentence using targetPhrase verbatim>",
  "exampleTranslation": "<natural Vietnamese translation>"
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}

Output format reference (format=phrase-choice example):
{
  "format": "phrase-choice",
  "targetPhrase": "<correct full phrase>",
  "verb": "<verb only>",
  "noun": "<noun/object only>",
  "sentence": "Which phrase sounds most natural?",
  "wrongAnswers": ${JSON.stringify(wrongAnswersPhraseChoice, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "<1–2 casual Vietnamese sentences>",
  "exampleSentence": "<authentic English sentence using targetPhrase verbatim>",
  "exampleTranslation": "<natural Vietnamese translation>"
}`;
}
