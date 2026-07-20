export interface ConversationQuestion {
  dialogueLines: string[]; // exactly 4 items, one contains "___"
  sentence: string; // dialogueLines.join('\n') — used as canvas `question`
  sentenceTranslation: string; // Full VI translation with blank filled, lines joined by \n
  highlightedWord: string; // Exact VI substring in sentenceTranslation to highlight
  correctAnswer: string; // English word/phrase filling the blank
  correctAnswerTranslation: string; // Concise VI meaning (1-5 words)
  wrongAnswers: string[]; // exactly optionCount-1 items
  optionTranslations: string[]; // VI meanings of wrongAnswers, same order
  wrongAnswerExplanations: string[]; // Why each wrong answer fails in this dialogue, same order
  explanation: string; // 1-2 sentence VI explanation
  exampleSentence: string; // Different example sentence
  exampleTranslation: string; // VI translation of exampleSentence
}

const EXAMPLE_WRONG_ANSWERS = ['pick up', 'hand over', 'set aside', 'turn down'];
const EXAMPLE_OPTION_TRANSLATIONS = ['nhặt lên / đến đón', 'giao lại / trao cho', 'để sang một bên', 'từ chối'];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Pick up có nghĩa nhặt lên hoặc đến đón ai, nhưng trong đoạn hội thoại này B đang hỏi về việc ai thanh toán bữa ăn — pick up không diễn tả được hành động chi trả tiền trong ngữ cảnh này.',
  'Hand over có nghĩa giao lại vật gì đó cho người khác, nhưng trong đoạn hội thoại này cuộc trò chuyện đang bàn về ai trả tiền bữa ăn — hand over không phù hợp vì không có gì được trao tay ở đây.',
  'Set aside có nghĩa để sang một bên hoặc tạm gác lại, nhưng trong đoạn hội thoại này B hỏi về việc thanh toán ngay tại chỗ — set aside không diễn tả được hành động chi trả tiền.',
  'Turn down có nghĩa từ chối hoặc giảm âm lượng, nhưng trong đoạn hội thoại này A đang đề nghị trả tiền một cách tích cực — turn down hoàn toàn sai chiều với ý nghĩa câu.'
];

export function buildConversationPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const optionTranslations = EXAMPLE_OPTION_TRANSLATIONS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);

  const exampleLines = [
    'Kaka: Hey, want to grab lunch together?',
    "Gâu Tí: Sure! I'm ___ for something light — maybe just a salad.",
    'Kaka: Perfect, I know a good place nearby.',
    "Gâu Tí: Great, let's head out now then."
  ];
  const exampleSentence = exampleLines.join('\\n');
  const exampleTranslation =
    'Kaka: Này, ra ăn trưa cùng nhau không?\\nGâu Tí: Được chứ! Tôi đang thèm ăn nhẹ — có khi chỉ cần salad thôi.\\nKaka: Tuyệt, tôi biết một chỗ gần đây ngon lắm.';

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Build a completely fresh dialogue and word selection for each item
  - Each item must pass the context-lock self-test for its OWN dialogue
  - Each item must have specific wrongAnswerExplanations referencing THIS item's dialogue context
  - Each item must have a fresh exampleSentence in a different daily-life scenario

UNIQUENESS (in addition to individual quality):
  - No two items share the same tested word or phrase (including near-variants)
  - No two items share the same dialogue scenario or setting
  - Vary the conversation topic (food, plans, shopping, health, etc.) across items

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Reusing dialogue scenarios or settings across items
  - Using the same wrong answer candidates across items
  - Writing dialogues that all follow the same question-answer structure
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - The dialogue scenario (all 4 lines) must take place within a "${topic}" context — a conversation about situations, activities, or locations related to "${topic}"
  - "correctAnswer": must be a word or phrase that arises naturally in a "${topic}" conversation
  - "exampleSentence": must also depict a scenario related to "${topic}"
DO NOT generate a dialogue on an unrelated topic and merely mention "${topic}" in passing. The entire conversation must be genuinely situated in the "${topic}" context.
REJECT and restart your dialogue if it does not naturally belong to a "${topic}" scenario.
MANDATORY TOPIC RESTRICTION override: Among the allowed daily-life topics (ordering food, making plans, shopping, health, work, school, travel, etc.), prioritize whichever category best aligns with "${topic}".
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';

  // maxOutputTokens guidance: base ~1200 tokens * count
  const singleSchema = `{
  "dialogueLines": ["string", "string", "string", "string"],
  "sentence": "string",
  "sentenceTranslation": "string",
  "highlightedWord": "string",
  "correctAnswer": "string",
  "correctAnswerTranslation": "string",
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "optionTranslations": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": "string",
  "exampleSentence": "string",
  "exampleTranslation": "string"
}`;

  const outputInstruction =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] } (no explanation, no markdown, no code fences):\n${singleSchema}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown, no code fences):\n${singleSchema}`;

  return `You are an English conversation fill-in-the-blank quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
You will freely choose a common English word or short phrase to test, then create a short natural dialogue (EXACTLY 4 lines between Kaka and Gâu Tí) where one line contains "___" replacing that word. Do NOT use any external word list — choose the word based entirely on the difficulty context and the conversation you construct.

CRITICAL: "wrongAnswers", "optionTranslations", and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${outputInstruction}

CRITICAL JSON FORMATTING RULES — violations will cause a parse error:
- All string values must be valid JSON strings: use \\" for quotes inside strings, \\n for newlines inside strings
- "dialogueLines" must be a JSON array of EXACTLY 4 strings
- "wrongAnswers", "optionTranslations", "wrongAnswerExplanations" must each be JSON arrays of EXACTLY ${wrongAnswerCount} strings
- Do NOT add trailing commas, comments, or any text outside the JSON object

Rules:

- "dialogueLines": EXACTLY 4 natural English dialogue lines, alternating "Kaka: " and "Gâu Tí: " prefixes
  - Exactly ONE line contains "___" replacing the tested word/phrase
  - Use contractions (don't, I'll, can't, etc.) and informal spoken register
  - Lines must sound like a real everyday conversation

  MANDATORY TOPIC RESTRICTION — MUST be one of these daily-life topics:
  ordering food / meals, making plans, shopping, health / doctor visits, work tasks, school / studying,
  travel / commuting, asking a favor, giving advice, family, relationships / friendships, casual greetings.
  No technical, academic, scientific, or specialized topics allowed.

  WORD SELECTION — the tested word must:
  - Occur naturally in spoken everyday English
  - Have exactly ONE correct fill that native speakers would unanimously agree on

  CONTEXT-LOCK REQUIREMENT — the dialogue must narrow the blank to ONE answer:
  - At least ONE must be present:
    (a) adjacent lines reveal the scenario so only one word fits
    (b) the blank line has a strong collocate that exclusively pairs with the correct word
    (c) the following line confirms the direction of the correct word
  - Dialogues where 2+ words sound equally natural are NOT acceptable

  MANDATORY SELF-TEST before finalizing:
  "If I substitute each wrong answer into the blank, does the dialogue clearly break down in a way I can explain using THIS dialogue?"
  → Must be YES for every wrong answer.

- "sentence": join dialogueLines with the literal two-character sequence backslash-n (\\n) — this becomes a \\n escape in JSON
  - Must contain exactly one "___"
  - Example of correct format: "Kaka: line one\\nGâu Tí: line two\\nKaka: line three"

- "sentenceTranslation": full Vietnamese translation of the entire dialogue with the blank filled in
  - Use "Kaka: " / "Gâu Tí: " prefixes in Vietnamese
  - Join translated lines with \\n the same way as "sentence"
  - Do NOT write "___" — fill in the correct word's Vietnamese meaning naturally

- "highlightedWord": exact Vietnamese word or short phrase in sentenceTranslation that maps to correctAnswer
  - Must be a verbatim substring of sentenceTranslation
  - Keep as short as possible (1-3 words)

- "correctAnswer": English word or short phrase filling "___" (1-3 words max)

- "correctAnswerTranslation": concise Vietnamese meaning of correctAnswer (1-5 words)

- "wrongAnswers": EXACTLY ${wrongAnswerCount} English words/phrases wrong for THIS dialogue
  - Same part of speech or collocation pattern as correctAnswer
  - Grammatically valid in the blank position
  - Wrong specifically due to THIS dialogue's context, not just wrong in theory
  - Must NOT be proper nouns

  MANDATORY CONTEXT VERIFICATION — for each wrong answer candidate:
  "If I put [wrongWord] in the blank, does the dialogue become clearly wrong in a way I can explain using elements of THIS dialogue?"
  If NO or UNSURE → reject and replace.

- "optionTranslations": EXACTLY ${wrongAnswerCount} concise Vietnamese meanings for each wrongAnswer, same order (1-5 words each)

- "wrongAnswerExplanations": EXACTLY ${wrongAnswerCount} items explaining in 1 friendly Vietnamese sentence why each wrong answer fails IN THIS DIALOGUE
  - Same count and order as wrongAnswers
  - Must reference the specific dialogue context
  - Required format: "[Từ X] có nghĩa [Y], nhưng trong đoạn hội thoại này [yếu tố cụ thể] cho thấy [đặc điểm đáp án đúng] — [từ X] không diễn tả được điều đó."
  - Do NOT use markdown formatting (no **bold**, no *italic*)

- "explanation": 1-2 friendly Vietnamese sentences explaining why correctAnswer fits this conversation
  - Reference the specific dialogue as evidence
  - Do NOT include an example sentence here, do NOT use markdown

- "exampleSentence": a DIFFERENT natural English sentence using correctAnswer (not from the dialogue)

- "exampleTranslation": natural Vietnamese translation of exampleSentence

IMPORTANT — Proper noun prohibition:
The dialogue, correctAnswer, and ALL wrongAnswers must NEVER consist entirely of proper nouns.

Example output (with exactly ${wrongAnswerCount} wrong answers)${count > 1 ? ` — showing 1 of ${count} items in the "questions" array` : ''}:
${count > 1 ? `{ "questions": [` : ''}
{
  "dialogueLines": ${JSON.stringify(exampleLines)},
  "sentence": "${exampleSentence}",
  "sentenceTranslation": "${exampleTranslation}",
  "highlightedWord": "thèm ăn nhẹ",
  "correctAnswer": "craving",
  "correctAnswerTranslation": "thèm, muốn ăn",
  "wrongAnswers": ${JSON.stringify(wrongAnswers)},
  "optionTranslations": ${JSON.stringify(optionTranslations)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations)},
  "explanation": "Craving diễn tả cảm giác thèm muốn điều gì đó cụ thể — trong câu này B nói rõ 'something light, maybe just a salad' xác nhận đây là sở thích ăn uống nhất thời, rất tự nhiên với craving.",
  "exampleSentence": "I've been craving pizza all day — let's just order some tonight.",
  "exampleTranslation": "Tôi thèm pizza cả ngày rồi — tối nay đặt đi thôi."
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
