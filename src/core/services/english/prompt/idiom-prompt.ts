export interface IdiomQuestion {
  idiom: string;
  correctAnswer: string; // Vietnamese meaning of the whole idiom (5-20 words)
  wrongAnswers: string[]; // Exactly optionCount-1 items
  wrongAnswerExplanations: string[]; // Same count as wrongAnswers
  explanation: string; // 1-2 câu tiếng Việt, không chứa ví dụ, không markdown
  exampleSentence: string; // Idiom used naturally in context
  exampleTranslation: string; // Vietnamese translation
}

// Format-only examples — not tied to any real idiom, used to show wrongAnswerExplanations structure
const EXAMPLE_WRONG_ANSWERS = [
  'sẵn sàng thỏa hiệp và nhượng bộ để tránh xung đột',
  'nói thẳng thắn dù có thể gây khó chịu cho người nghe',
  'từ chối làm điều gì đó vì quá khó khăn',
  'cố gắng hết sức để đạt mục tiêu bất chấp cản trở'
];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Thỏa hiệp và nhượng bộ nói về việc giảm yêu cầu để tránh mâu thuẫn — còn idiom này thực ra diễn tả [nghĩa đúng], hai hành động hoàn toàn trái ngược nhau về bản chất.',
  'Nói thẳng thắn dù khó chịu mô tả phong cách giao tiếp — còn idiom này nói về [nghĩa đúng], không liên quan đến cách diễn đạt hay giao tiếp.',
  'Từ chối vì quá khó là hành động ngược lại với idiom này — idiom này chính xác là [nghĩa đúng], hai khái niệm đối lập nhau hoàn toàn.',
  'Cố gắng đạt mục tiêu nói về động lực và nỗ lực — còn idiom này tập trung vào [nghĩa đúng], không phải về thành tích hay kết quả.'
];

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Handling difficulty & perseverance',
  2: 'Communication & conversation dynamics',
  3: 'Work, career & productivity',
  4: 'Relationships & social dynamics',
  5: 'Money, luck & risk',
  6: 'Emotions & mental states',
  7: 'Time & urgency',
  8: 'Decisions & actions'
};

function buildExclusionBlock(excludeIdioms: string[]): string {
  if (excludeIdioms.length === 0) return '';

  const list = excludeIdioms.map((w, i) => `  ${i + 1}. "${w}"`).join('\n');

  return `
════════════════════════════════════════════════════
  FORBIDDEN IDIOMS — ABSOLUTE HARD BLOCK
════════════════════════════════════════════════════
  The ${excludeIdioms.length} idiom(s) below MUST NOT appear as the "idiom" field.
  Violating this block = the entire response is discarded and regenerated.

${list}

  MANDATORY PRE-OUTPUT CHECKLIST (answer internally before writing JSON):
  ✔ Q1: Is my chosen idiom listed above? → YES = pick a different idiom, NO = continue
  ✔ Q2: Is my chosen idiom a variant, conjugated form, or semantic twin of any forbidden idiom?
         (e.g. if "spill the beans" is blocked, "spilling the beans" is also blocked) → YES = pick again, NO = continue
  Only proceed to output if Q1=NO and Q2=NO.
════════════════════════════════════════════════════
`;
}

export function buildIdiomPrompt(
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
  - Perform full idiom selection and self-verification for each item separately
  - Each item must pass the forbidden idiom checklist independently
  - Each item must have specific wrongAnswerExplanations with clear semantic conflict reasoning
  - Each item must have a fresh, authentic exampleSentence in a different real-life context

UNIQUENESS (in addition to individual quality):
  - No two items share the same idiom or any variant of it
  - No two items share the same exampleSentence scenario or life context
  - Vary idiom category across items — do not cluster in the same semantic domain

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Choosing idioms from the same semantic domain repeatedly
  - Reusing the same wrong answer candidates across items
  - Writing formal or textbook-style exampleSentences
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "idiom": must be an idiom commonly used in, or naturally applicable to, "${topic}" situations or contexts
  - "exampleSentence": must depict a scenario clearly situated in a "${topic}" context
DO NOT generate a question where the idiom is forced into the topic through an unnatural example sentence. If the idiom does not organically connect to "${topic}", choose a different idiom entirely.
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';

  const singleSchema = `{
  "idiom": string,
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
      : `Return ONLY valid JSON (no explanation, no markdown):\n${singleSchema}`;

  const categoryRotationBlock = Object.entries(CATEGORY_NAMES)
    .map(([num, name]) => `  CAT ${num} — ${name}`)
    .join('\n');

  return `You are an English idiom meaning quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
GENERATION SOURCE — MANDATORY:
Your idiom MUST come entirely from your own internalized knowledge. The categories below are semantic buckets to guide diversity — they are NOT word banks. Do NOT:
  - Use any idiom named anywhere in this prompt (forbidden list, schema labels, or anywhere else)
  - Treat any named string in this prompt as an output candidate
  - Default to the most famous or textbook-obvious idiom for a given domain
The goal is to surface idioms that are genuinely useful to Vietnamese learners, drawn from your full internalized knowledge — not retrieved from this prompt's text.
${exclusionBlock}
CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${outputInstruction}

Rules:
- "idiom": a real English idiom or fixed idiomatic expression — chosen freely from your own knowledge, NOT from this prompt.
  - Must be a multi-word expression (not a single word)
  - Must be used in modern conversational, daily, or informal/business English
  - Preferred domains: everyday conversations, workplace, social interactions, emotions, decisions, time
  - Avoid idioms so rare that a Vietnamese learner would never encounter them in real English content
  - Must NOT be a proper noun or contain a proper noun
  - ABSOLUTE RULE: must NOT match or paraphrase any string named in this prompt

- "correctAnswer": accurate Vietnamese meaning of the WHOLE idiom as one idiomatic unit (5-20 words)
  - Must capture the figurative meaning, NOT word-by-word translation
  - Must reflect how a native speaker actually uses it, including register if relevant
  - Must NOT be a proper noun

- "wrongAnswers": EXACTLY ${wrongAnswerCount} plausible but ABSOLUTELY INCORRECT Vietnamese meanings
  - Must represent meanings of COMPLETELY DIFFERENT idioms or expressions
  - Must NOT be partial meanings, paraphrases, or "one aspect of" the correct meaning

  MANDATORY SELF-VERIFICATION — before finalizing each wrong answer, ask:
  "Is there any context where this Vietnamese meaning could describe what this idiom actually means?"
  If YES or MAYBE → reject and replace. Every wrong answer must pass with a definitive NO.

  ANTI-PARAPHRASE CHECK: "Could a learner argue this is basically the same as the correct meaning?" If YES or MAYBE → replace.

- "wrongAnswerExplanations": EXACTLY ${wrongAnswerCount} items, same order as wrongAnswers. 1 friendly Vietnamese sentence each.
  Required format: "[Nghĩa X] nói về [mô tả X], còn '[idiom]' thực ra có nghĩa là [đúng] — [lý do cụ thể tại sao hai nghĩa này không thể trùng]."
  Must explain the semantic conflict clearly — not just say "nghĩa khác nhau". No markdown.

- "explanation": 1-2 casual Vietnamese sentences
  - Sentence 1: real idiomatic meaning + typical usage context (work meeting, casual chat, emotional moment, etc.)
  - Sentence 2 (optional): origin story, common Vietnamese equivalent phrase, or a memory tip
  - Do NOT include an example sentence here. Do NOT use markdown.

- "exampleSentence": natural English sentence using the idiom as it would appear in a real conversation, email, or everyday situation
  - Must feel authentic — not textbook-formal, not contrived
  - The idiom must appear verbatim in the sentence

- "exampleTranslation": natural Vietnamese translation of exampleSentence (not word-for-word literal)

CATEGORY ROTATION — to ensure diversity across sessions, rotate across these 8 semantic domains:
${categoryRotationBlock}

Selection process:
1. Look at the forbidden idioms list above (if any) — consider what semantic domains they cover.
2. Pick a domain that is NOT well-represented in the recent forbidden list.
3. From that domain, choose an idiom from your own internalized knowledge — not the most obvious one, and NOT named anywhere in this prompt.
4. Must be: modern (actively used), appropriate for general audiences, naturally occurring in real conversations or professional settings.

Output format reference (${wrongAnswerCount} wrong answers)${count > 1 ? ` — repeat for each of the ${count} items in the "questions" array` : ''}:
${count > 1 ? '{ "questions": [' : ''}
{
  "idiom": "<idiom from your own knowledge — not from this prompt>",
  "correctAnswer": "<Vietnamese meaning, 5–20 words, idiomatic>",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "<1–2 casual Vietnamese sentences: meaning + context, optionally origin or tip>",
  "exampleSentence": "<authentic English sentence using the idiom verbatim>",
  "exampleTranslation": "<natural Vietnamese translation>"
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
