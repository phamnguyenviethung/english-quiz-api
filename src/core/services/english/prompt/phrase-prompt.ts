export interface PhraseQuestion {
  phrase: string; // Phrase AI tự chọn, e.g. "get over sth"
  correctAnswer: string; // Nghĩa tiếng Việt của cả cụm từ
  wrongAnswers: string[]; // 3 items (A1) or 4 items (A2+)
  wrongAnswerExplanations: string[]; // Cùng thứ tự wrongAnswers
  explanation: string; // 1-2 câu tiếng Việt, không chứa ví dụ, không markdown
  exampleSentence: string; // Câu tiếng Anh dùng phrase tự nhiên (thay sth/sb bằng từ thật)
  exampleTranslation: string; // Dịch tiếng Việt của exampleSentence
}

const EXAMPLE_WRONG_ANSWERS = [
  'từ chối tiếp nhận điều gì đó, phủ nhận thực tế',
  'trì hoãn việc giải quyết điều gì đó đến sau',
  'thông báo công khai về điều gì đó với mọi người',
  'thực hiện ngay điều gì đó mà không cần suy nghĩ'
];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Từ chối tiếp nhận nói về việc loại bỏ hoàn toàn một điều gì đó — còn "take sth into account" thực ra là chủ động đưa yếu tố đó vào cân nhắc khi ra quyết định, hai hành động hoàn toàn trái ngược nhau.',
  'Trì hoãn đến sau nói về việc tạm gác lại để xử lý sau — còn "take sth into account" là cân nhắc ngay tại thời điểm ra quyết định, khác nhau hoàn toàn về thời điểm và mục đích hành động.',
  'Thông báo công khai là hành động chia sẻ thông tin ra bên ngoài — còn "take sth into account" là quá trình suy nghĩ nội tâm khi ra quyết định, hai thứ không liên quan nhau về đối tượng lẫn mục đích.',
  'Thực hiện ngay không suy nghĩ là làm ngược lại với "take sth into account" — vốn nhấn mạnh việc phải dừng lại và cân nhắc kỹ lưỡng trước khi quyết định.'
];

// Maps known phrases to their category number (1-8)
const PHRASE_CATEGORY_MAP: Record<string, number> = {
  // CAT 1 — Everyday greetings & small talk
  'long time no see': 1,
  'catch up with sb': 1,
  'break the ice': 1,
  'make small talk': 1,
  "how's it going": 1,
  'nice to meet you': 1,
  "what's up": 1,
  'keep in touch': 1,
  'drop by': 1,
  'hang out with sb': 1,
  'touch base with sb': 1,
  // CAT 2 — Plans & decisions
  "make up one's mind": 2,
  'go ahead with sth': 2,
  'call sth off': 2,
  'put sth on hold': 2,
  "change one's mind": 2,
  'figure sth out': 2,
  "weigh one's options": 2,
  'come up with sth': 2,
  'decide on sth': 2,
  'back out of sth': 2,
  'narrow sth down': 2,
  'settle on sth': 2,
  // CAT 3 — Emotions & feelings
  "get on sb's nerves": 3,
  'feel down': 3,
  'cheer sb up': 3,
  "lose one's temper": 3,
  'be over the moon': 3,
  'drive sb crazy': 3,
  'calm down': 3,
  'look on the bright side': 3,
  'be in a good mood': 3,
  'get carried away': 3,
  'hold back tears': 3,
  // CAT 4 — Work & productivity
  'take a break': 4,
  'meet a deadline': 4,
  "pull one's weight": 4,
  'burn out': 4,
  'get the ball rolling': 4,
  'keep up with sth': 4,
  'take on sth': 4,
  'work out': 4,
  'sort sth out': 4,
  'stay on top of sth': 4,
  'wrap sth up': 4,
  'pick up the pace': 4,
  // CAT 5 — Shopping & money
  'run out of sth': 5,
  'splash out on sth': 5,
  'get a bargain': 5,
  'cut back on sth': 5,
  'pick up the tab': 5,
  'save up for sth': 5,
  'go over budget': 5,
  'shop around': 5,
  'get a refund': 5,
  'pay sb back': 5,
  'go Dutch': 5,
  // CAT 6 — Travel & food
  'eat out': 6,
  'grab a bite': 6,
  'check in': 6,
  'get lost': 6,
  'try sth out': 6,
  'set off': 6,
  'stop over': 6,
  'pick sth up': 6,
  'go sightseeing': 6,
  "pack one's bags": 6,
  'dig in': 6,
  // CAT 7 — Relationships & social
  'fall out with sb': 7,
  'make it up to sb': 7,
  'stand sb up': 7,
  'grow apart': 7,
  'get along with sb': 7,
  'reach out to sb': 7,
  'let sb down': 7,
  'make up with sb': 7,
  'drift apart': 7,
  'look out for sb': 7,
  // CAT 8 — Health, school & hobbies
  'come down with sth': 8,
  'fall behind': 8,
  'give sth a shot': 8,
  'take sth up': 8,
  'get in shape': 8,
  'cut down on sth': 8,
  'pick sth up again': 8,
  'stay up late': 8,
  'catch up on sth': 8,
  'push oneself': 8,
  'take it easy': 8
};

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Everyday greetings & small talk',
  2: 'Plans & decisions',
  3: 'Emotions & feelings',
  4: 'Work & productivity',
  5: 'Shopping & money',
  6: 'Travel & food',
  7: 'Relationships & social',
  8: 'Health, school & hobbies'
};

function buildExclusionBlock(excludePhrases: string[]): string {
  if (excludePhrases.length === 0) return '';

  const catCounts: Record<number, number> = {};
  excludePhrases.forEach((p) => {
    const cat = PHRASE_CATEGORY_MAP[p.toLowerCase()];
    if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  let leastUsedCat = 1;
  let minCount = Infinity;
  for (let cat = 1; cat <= 8; cat++) {
    const count = catCounts[cat] ?? 0;
    if (count < minCount) {
      minCount = count;
      leastUsedCat = cat;
    }
  }

  const catSummary = Object.entries(catCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([cat, count]) => `CAT ${cat}: ${count}`)
    .join(' | ');

  const list = excludePhrases
    .map((p, i) => {
      const cat = PHRASE_CATEGORY_MAP[p.toLowerCase()];
      return `  ${i + 1}. "${p}"${cat ? ` [CAT ${cat}]` : ''}`;
    })
    .join('\n');

  return `
════════════════════════════════════════════
  FORBIDDEN — DO NOT USE AS "phrase" FIELD
════════════════════════════════════════════
${list}

  Recent category spread: ${catSummary || 'none'}
  DIRECTIVE: Target CAT ${leastUsedCat} — "${CATEGORY_NAMES[leastUsedCat]}" (least recent)

  Before writing JSON, confirm internally:
  • My phrase is NOT in the list above (exact or near-variant) → proceed
  • My phrase targets CAT ${leastUsedCat} if possible → proceed
════════════════════════════════════════════
`;
}

export function buildPhrasePrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludePhrases?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludePhrases = options?.excludePhrases ?? [];
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);
  const exclusionBlock = buildExclusionBlock(excludePhrases);

  const batchBlock =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full phrase selection reasoning for each item separately
  - Each item must pass ALL self-verification checks (anti-paraphrase check, exclusion check, proper noun check, etc.)
  - Each item must have specific, non-abbreviated wrongAnswerExplanations
  - Each item must have a fresh, non-formulaic exampleSentence with real concrete words replacing sth/sb

UNIQUENESS (in addition to individual quality):
  - No two items share the same phrase or a functionally equivalent phrase
  - No two items share the same exampleSentence scenario or setting
  - Vary category (CAT 1–8), register, and formality level across items

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Reusing the same wrong answer candidates across items
  - Using the same scenario setting for multiple exampleSentences
  - Choosing phrases from the same category repeatedly
`
      : '';

  const topicBlock = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "phrase": must be a phrase or expression that is commonly used in, or naturally arises from, "${topic}" situations
  - "exampleSentence": must depict a scenario clearly situated in a "${topic}" context
DO NOT generate a question where the phrase is unrelated to "${topic}" and merely rescued by a topic-flavored example sentence. If the phrase does not naturally fit "${topic}", choose a different phrase entirely.
REJECT and restart your selection if you cannot genuinely connect the phrase to "${topic}" without forcing it.
CATEGORY OVERRIDE: If this topic maps to one of the phrase categories (CAT 1–8), override the DIRECTIVE from the exclusion block and prioritize phrases from that matching category instead.
  Examples: "Technology" → CAT 4 (Work & productivity) or CAT 8 (Health, school & hobbies); "Travel" → CAT 6 (Travel & food); "Shopping" → CAT 5 (Shopping & money); "Relationships" → CAT 7 (Relationships & social)
Note: "wrongAnswers" and their explanations are EXEMPT from the topic constraint — they exist as plausible distractors and do not need to share the topic context.
`
    : '';

  // maxOutputTokens guidance: base ~800 tokens * count
  const singleSchema = `{
  "phrase": string,
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

  return `You are an English phrase meaning quiz generator for Vietnamese learners.
${batchBlock}${topicBlock}
Choose one English phrase, collocation, or phrasal verb yourself — rotate across different everyday topics and contexts. Prioritize practical daily-life phrases a learner can immediately use in real conversations.

SELF-SELECTION RULE: Do NOT pick any phrase that appears anywhere in this system prompt (category lists, examples, schema examples, etc.). Those are illustrations only — your chosen phrase must come from your own knowledge of common English phrases not already mentioned here.
${exclusionBlock}
CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items.

${outputInstruction}

Rules:
- "phrase": the phrase you freely chose — a real English phrase, collocation, or phrasal verb. Include placeholder tokens like "sth"/"sb"/"sb's" if applicable. Must be useful for daily speech (not formal/academic). Must NOT be a proper noun.
- "correctAnswer": accurate Vietnamese meaning of the WHOLE phrase as a single idiomatic unit (5-15 words). Use the idiomatic sense, NOT word-by-word translation. Replace "sth"/"sb"/"sb's" with "điều gì đó"/"ai đó"/"của ai đó".
- "wrongAnswers": EXACTLY ${wrongAnswerCount} plausible but ABSOLUTELY INCORRECT Vietnamese meanings. Must represent meanings of COMPLETELY DIFFERENT phrases — NOT partial meanings, paraphrases, or "one aspect of" the correct meaning. The core action/concept of correctAnswer must be ENTIRELY ABSENT from each wrong answer.

  ANTI-PARAPHRASE CHECK — before finalizing each wrong answer, ask: "Could a learner argue this is basically the same as or part of the correct meaning?" If YES or MAYBE → replace.

- "wrongAnswerExplanations": EXACTLY ${wrongAnswerCount} items (same order). 1 sentence each explaining WHY the wrong answer is incompatible — state both what the correct phrase actually means AND what makes the wrong answer fundamentally different. No markdown.
- "explanation": 1-2 casual Vietnamese sentences — real meaning, usage context, register note if relevant. No example sentence here. No markdown.
- "exampleSentence": natural English sentence using the phrase. CRITICAL: replace ALL sth/sb/sb's tokens with real concrete words — NEVER write them literally. Must feel like authentic daily-life speech.
- "exampleTranslation": natural Vietnamese translation (not word-for-word literal).

PHRASE CATEGORY ROTATION — pick from the category LEAST used recently (see DIRECTIVE above):
  CAT 1 — Everyday greetings & small talk: long time no see, catch up with sb, break the ice, how's it going, keep in touch, touch base with sb
  CAT 2 — Plans & decisions: make up one's mind, call sth off, put sth on hold, figure sth out, come up with sth, narrow sth down
  CAT 3 — Emotions & feelings: get on sb's nerves, cheer sb up, lose one's temper, be over the moon, get carried away, hold back tears
  CAT 4 — Work & productivity: meet a deadline, pull one's weight, burn out, get the ball rolling, wrap sth up, pick up the pace
  CAT 5 — Shopping & money: splash out on sth, get a bargain, cut back on sth, pick up the tab, go over budget, go Dutch
  CAT 6 — Travel & food: eat out, grab a bite, set off, stop over, go sightseeing, dig in
  CAT 7 — Relationships & social: fall out with sb, make it up to sb, stand sb up, grow apart, let sb down, drift apart
  CAT 8 — Health, school & hobbies: come down with sth, fall behind, give sth a shot, get in shape, cut down on sth, take it easy

Example output (${wrongAnswerCount} wrong answers)${count > 1 ? ` — showing 1 of ${count} items in the "questions" array` : ''}:
${count > 1 ? `{ "questions": [` : ''}
{
  "phrase": "take sth into account",
  "correctAnswer": "xem xét, cân nhắc điều gì đó khi đưa ra quyết định",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "Take sth into account nghĩa là xem xét, tính đến một yếu tố nào đó khi đưa ra quyết định hay đánh giá tình huống. Cụm này rất phổ biến trong văn viết lẫn văn nói, thường xuất hiện khi bàn về kế hoạch hoặc đánh giá.",
  "exampleSentence": "When planning the trip, we need to take everyone's budget into account.",
  "exampleTranslation": "Khi lên kế hoạch chuyến đi, chúng ta cần cân nhắc đến ngân sách của mọi người."
}${count > 1 ? `, ... (${count - 1} more) ] }` : ''}`;
}
