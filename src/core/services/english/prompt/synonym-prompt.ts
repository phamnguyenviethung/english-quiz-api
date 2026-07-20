export interface SynonymQuestion {
  word: string;
  questionType: 'synonym' | 'antonym';
  partOfSpeech: string;
  correctAnswer: string; // English word (synonym or antonym of word)
  wrongAnswers: string[]; // English words, exactly optionCount-1
  wrongAnswerExplanations: string[]; // Vietnamese explanations, same order as wrongAnswers
  explanation: string; // 1-2 câu tiếng Việt, không chứa ví dụ, không markdown
  exampleSentence: string; // Dùng "word" gốc, không phải correctAnswer
  exampleTranslation: string;
}

const EXAMPLE_WRONG_ANSWERS = ['stubborn', 'clumsy', 'careless', 'selfish'];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Stubborn (bướng bỉnh, cố chấp) nói về việc từ chối thay đổi ý kiến dù không có lý — không liên quan gì đến sự dũng cảm hay nhút nhát; người bướng bỉnh hoàn toàn có thể rất gan dạ.',
  'Clumsy (vụng về, hay làm đổ vỡ) mô tả người thiếu khéo léo về mặt thể chất — không phản ánh thái độ đối mặt với nguy hiểm hay rủi ro, hoàn toàn khác với cowardly.',
  'Careless (bất cẩn, thiếu chú ý) nói về việc không để tâm đến hậu quả — không liên quan đến cảm giác sợ hãi hay can đảm khi đối mặt với thử thách.',
  'Selfish (ích kỷ, chỉ nghĩ cho bản thân) mô tả thái độ thiếu quan tâm đến người khác — hoàn toàn độc lập với sự dũng cảm hoặc hèn nhát, người ích kỷ vẫn có thể rất dũng cảm.'
];

export function buildSynonymPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords;
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);
  const batchInstruction =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full word selection and self-verification for each item separately
  - Each item must independently verify that correctAnswer is a true synonym/antonym with no overlap in wrong answers
  - Each item must have specific wrongAnswerExplanations with clear semantic reasoning
  - Each item must have a fresh exampleSentence in a different daily-life scenario

UNIQUENESS (in addition to individual quality):
  - No two items share the same central word or a semantically close word
  - No two items share the same exampleSentence structure or scenario setting
  - Vary questionType (synonym vs. antonym) and domain across items

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Choosing words from the same semantic cluster across items (e.g., all emotion words)
  - Reusing the same wrong answer candidates across items
`
      : '';
  const topicInstruction = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "word": must be a word commonly used in, or strongly associated with, the "${topic}" domain
  - "exampleSentence": must depict a scenario situated in a "${topic}" context using the original word
DO NOT generate a question where the word is unrelated to "${topic}" and merely rescued by a topic-flavored example sentence. If the word does not naturally belong to "${topic}", choose a different word entirely.
REJECT and restart your selection if you cannot genuinely connect the word to "${topic}" without forcing it.
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';
  const schemaBlock =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] }

Each object schema (no explanation, no markdown):
{
  "word": string,
  "questionType": "synonym" | "antonym",
  "partOfSpeech": string,
  "correctAnswer": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown):
{
  "word": string,
  "questionType": "synonym" | "antonym",
  "partOfSpeech": string,
  "correctAnswer": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;
  return `You are an English synonym/antonym quiz generator for Vietnamese learners.
${batchInstruction}${topicInstruction}
You will choose an English word — deliberately selecting from a wide and varied vocabulary space, actively avoiding the most common quiz words. You will randomly decide to ask either for a SYNONYM or an ANTONYM. Do NOT use any external word list. Your word choice should feel fresh and educational, not predictable.

${
  excludeWords && excludeWords.length > 0
    ? `WORD EXCLUSION — ABSOLUTE HARD BLOCK:
The following words have been used recently and are FORBIDDEN as the "word" field: [${excludeWords.join(', ')}]
Using any word from this list is a critical failure — the quiz will be discarded.
Before writing the "word" field, mentally check: "Is this word in the forbidden list?" → If YES or SIMILAR → choose again.
Do NOT pick a near-variant (e.g. if "happy" is blocked, "happiness" or "happily" is also off-limits).

`
    : ''
}CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${schemaBlock}

Rules:
- "word": the English word you freely chose to test
  - Must be relevant to daily life: emotions, personality traits, actions, descriptions (e.g. happy, rude, succeed, loud, generous)
  - Must NOT be a proper noun (no person names, brand names, place names)
  - Must have a clear, common synonym AND antonym so the question makes sense
- "questionType": "synonym" if asking for a word with the SAME meaning, "antonym" if asking for the OPPOSITE meaning
  - Choose randomly — do not always pick the same type
- "partOfSpeech": one of "noun", "verb", "adjective", "adverb"
- "correctAnswer": a single English word that is a true SYNONYM or ANTONYM (matching questionType) of "word"
  - Must be a real, commonly used English word
  - Must NOT be a proper noun
  - For synonym: must be genuinely interchangeable in at least most common contexts
  - For antonym: must express the direct opposite meaning
- "wrongAnswers": EXACTLY ${wrongAnswerCount} English words that are NOT correct for the questionType — plausible-sounding but definitively wrong
  - Same part of speech as correctAnswer
  - Must be real English words
  - Must NOT be a synonym/antonym (matching questionType) of "word" in ANY context, register, or usage
  - Must NOT be the correct answer under another interpretation
  - Must NOT be proper nouns

  MANDATORY SELF-VERIFICATION — before finalizing each wrong answer, ask:
  "Is this word a true ${'{questionType}'} of the tested word in ANY context?"
  If YES or MAYBE → reject and replace.
  Every wrong answer must pass this check with a definitive NO.

- "wrongAnswerExplanations": for EACH wrong answer, explain in 1 sentence (friendly Vietnamese) WHY it is not the correct synonym/antonym — EXACTLY ${wrongAnswerCount} items
  - Same count and order as wrongAnswers
  - Required format: "[Từ X] ([nghĩa tiếng Việt]) nói về [mô tả ngắn], [không liên quan / khác hoàn toàn] với [word] vì [lý do cụ thể]."
  - Must clearly explain the semantic difference, not just say "nghĩa khác nhau"
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "explanation": 1-2 sentences in friendly Vietnamese
  - Explain the core meaning of "word" AND why "correctAnswer" is the true synonym/antonym
  - Mention any nuance if the relationship is not perfectly symmetrical
  - Do NOT include an example sentence here
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "exampleSentence": one natural English sentence using the ORIGINAL "word" (not correctAnswer) in daily-life context
  - Friends, school, work, social media, relationships, hobbies, etc.
  - Must NOT be a textbook-style sentence
- "exampleTranslation": natural Vietnamese translation of exampleSentence

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
4. The chosen word must have a clear synonym AND antonym.
5. Prefer words: not so simple a child knows them, not so rare they require a dictionary.

Example output (with exactly ${wrongAnswerCount} wrong answers):
{
  "word": "brave",
  "questionType": "antonym",
  "partOfSpeech": "adjective",
  "correctAnswer": "cowardly",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "Brave nghĩa là dũng cảm — sẵn sàng đối mặt với nguy hiểm hoặc khó khăn dù sợ hãi. Trái nghĩa cowardly (hèn nhát, nhút nhát) diễn tả việc tránh né nguy hiểm vì sợ hãi — hoàn toàn đối lập với brave về thái độ đối mặt thử thách.",
  "exampleSentence": "She was brave enough to speak up against the unfair rule at school.",
  "exampleTranslation": "Cô ấy đủ dũng cảm để lên tiếng phản đối quy định bất công ở trường."
}`;
}
