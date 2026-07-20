export interface SlangQuestion {
  slang: string; // The slang word or short phrase
  partOfSpeech: string;
  correctAnswer: string; // Vietnamese meaning of the slang
  wrongAnswers: string[]; // Vietnamese meanings, exactly optionCount-1
  wrongAnswerExplanations: string[]; // Vietnamese explanations, same order as wrongAnswers
  explanation: string; // 1-2 câu tiếng Việt, không chứa ví dụ, không markdown
  exampleSentence: string; // Dùng slang trong texting/social media/casual speech
  exampleTranslation: string;
}

const EXAMPLE_WRONG_ANSWERS = [
  'thừa nhận thất bại, không cố gắng thêm nữa',
  'nói quá lên, cường điệu để gây ấn tượng với người khác',
  'từ chối thẳng thắn lời đề nghị của ai đó',
  'im lặng và không có phản ứng gì trước tình huống'
];
const EXAMPLE_WRONG_EXPLANATIONS = [
  'Thừa nhận thất bại nói về việc bỏ cuộc và chấp nhận thua — còn "no cap" thực ra là khẳng định rằng mình đang nói thật, không liên quan gì đến thắng hay thua.',
  'Cường điệu để gây ấn tượng chính là điều ngược lại với "no cap" — "cap" nghĩa là nói phóng đại/nói dối, nên "no cap" là tuyên bố rõ rằng mình KHÔNG làm vậy.',
  'Từ chối lời đề nghị nói về hành động phủ nhận một yêu cầu — còn "no cap" là cụm xác nhận tính trung thực của điều vừa nói, không liên quan đến việc đồng ý hay từ chối.',
  'Im lặng không phản ứng mô tả thái độ thụ động — hoàn toàn trái ngược với "no cap" vốn là cách chủ động nhấn mạnh rằng mình đang nói thật và muốn người nghe tin.'
];

// Maps slang terms to their category number (1-8)
const SLANG_CATEGORY_MAP: Record<string, number> = {
  // CAT 1 — Authenticity & truth-telling
  'fr fr': 1,
  'on god': 1,
  deadass: 1,
  ngl: 1,
  highkey: 1,
  'real talk': 1,
  'keeping it 100': 1,
  iykyk: 1,
  periodt: 1,
  'no lies detected': 1,
  'no cap': 1,
  // CAT 2 — Reactions & emotional response
  'sending me': 2,
  "i'm dead": 2,
  shook: 2,
  pressed: 2,
  'big yikes': 2,
  'it slaps': 2,
  'not okay': 2,
  cooked: 2,
  unhinged: 2,
  "i can't even": 2,
  // CAT 3 — Social dynamics & people types
  'pick me': 3,
  npc: 3,
  'main character': 3,
  'understood the assignment': 3,
  'rent free': 3,
  'down bad': 3,
  parasocial: 3,
  'chronically online': 3,
  'crowd work': 3,
  'thought leader': 3,
  // CAT 4 — Quality & performance judgment
  'ate and left no crumbs': 4,
  mid: 4,
  'slept on': 4,
  'hits different': 4,
  bussin: 4,
  goated: 4,
  overrated: 4,
  underrated: 4,
  elite: 4,
  w: 4,
  l: 4,
  // CAT 5 — Online culture & internet behavior
  ratio: 5,
  'l + ratio': 5,
  'touch grass': 5,
  copium: 5,
  based: 5,
  'caught in 4k': 5,
  'villain arc': 5,
  era: 5,
  'core memory': 5,
  'roman holiday': 5,
  // CAT 6 — Appearance, vibe & aesthetics
  'glow up': 6,
  "it's giving": 6,
  'villain era': 6,
  serving: 6,
  snatched: 6,
  drip: 6,
  'fit check': 6,
  aesthetic: 6,
  slay: 6,
  'main character energy': 6,
  'that girl': 6,
  // CAT 7 — Gaming & competitive slang
  gg: 7,
  ez: 7,
  tryhard: 7,
  grind: 7,
  clutch: 7,
  carry: 7,
  tilted: 7,
  diff: 7,
  meta: 7,
  inting: 7,
  cracked: 7,
  'no-scope': 7,
  // CAT 8 — Dating & attraction
  ick: 8,
  situationship: 8,
  'talking stage': 8,
  'red flag': 8,
  'green flag': 8,
  'beige flag': 8,
  'slow fade': 8,
  'cuffing season': 8,
  'love bombing': 8,
  breadcrumbing: 8
};

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Authenticity & truth-telling',
  2: 'Reactions & emotional response',
  3: 'Social dynamics & people types',
  4: 'Quality & performance judgment',
  5: 'Online culture & internet behavior',
  6: 'Appearance, vibe & aesthetics',
  7: 'Gaming & competitive slang',
  8: 'Dating & attraction'
};

function buildExclusionBlock(excludeWords: string[]): string {
  const annotated = excludeWords
    .map((w, i) => {
      const cat = SLANG_CATEGORY_MAP[w.toLowerCase()];
      return `  ${i + 1}. "${w}"${cat ? ` [CAT ${cat} — ${CATEGORY_NAMES[cat]}]` : ''}`;
    })
    .join('\n');

  const catCounts: Record<number, number> = {};
  excludeWords.forEach((w) => {
    const cat = SLANG_CATEGORY_MAP[w.toLowerCase()];
    if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  // Find the category with fewest (or zero) recent terms
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
    .map(([cat, count]) => `CAT ${cat}: ${count} term(s)`)
    .join(' | ');

  return `
════════════════════════════════════════════════════
  FORBIDDEN SLANG — ABSOLUTE HARD BLOCK
════════════════════════════════════════════════════
  The ${excludeWords.length} term(s) below MUST NOT appear as the "slang" field.
  Violating this block = the entire response is discarded and regenerated.

${annotated}

  Category usage from the list above:
  ${catSummary || '(no categories matched)'}

  DIRECTIVE: Prioritize CAT ${leastUsedCat} — "${CATEGORY_NAMES[leastUsedCat]}"
  (it has the fewest recent terms — ${minCount === Infinity ? 0 : minCount})

  MANDATORY PRE-OUTPUT CHECKLIST (answer internally before writing JSON):
  ✔ Q1: Is my chosen slang word/phrase listed above? → YES = pick a different term, NO = continue
  ✔ Q2: Is my chosen slang a variant, abbreviation, or near-synonym of any forbidden term?
         (e.g. if "lit" is blocked, "totally lit" is also blocked) → YES = pick again, NO = continue
  ✔ Q3: Does my chosen slang belong to CAT ${leastUsedCat}? → NO = strongly reconsider and try to find one that does
  Only proceed to output if Q1=NO and Q2=NO.
════════════════════════════════════════════════════
`;
}

export function buildSlangPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords;
  const wrongAnswers = EXAMPLE_WRONG_ANSWERS.slice(0, wrongAnswerCount);
  const wrongExplanations = EXAMPLE_WRONG_EXPLANATIONS.slice(0, wrongAnswerCount);

  const exclusionBlock = buildExclusionBlock(excludeWords ?? []);

  const batchInstruction =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full slang selection and self-verification for each item separately
  - Each item must pass the forbidden slang checklist independently
  - Each item must have specific wrongAnswerExplanations with clear semantic conflict reasoning
  - Each item must have a fresh, authentic exampleSentence in a different conversational context

UNIQUENESS (in addition to individual quality):
  - No two items share the same slang term or a variant/abbreviation of it
  - No two items share the same exampleSentence scenario or social context
  - Vary slang category (CAT 1–8) across items — do not cluster in the same category

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Choosing slang terms from the same category repeatedly
  - Reusing the same wrong answer candidates across items
  - Writing formal or textbook-style exampleSentences for any item
`
      : '';
  const topicInstruction = topic
    ? `
TOPIC LOCK — "${topic}":
IMPORTANT: Slang terms are cultural/register phenomena and are NOT domain-specific. The topic constraint for slang applies ONLY to:
  - "exampleSentence": must depict a scenario or context in which this slang would naturally appear within a "${topic}" conversation or setting
  - "explanation" context: where relevant, frame the usage context around "${topic}" scenarios
The slang term selection itself is EXEMPT from the topic constraint — do NOT force a slang term to match "${topic}" if no natural fit exists. Instead, choose any appropriate slang and use a "${topic}"-themed example sentence.
`
    : '';
  const schemaBlock =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] }

Each object schema (no explanation, no markdown):
{
  "slang": string,
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
  "slang": string,
  "partOfSpeech": string,
  "correctAnswer": string,
  "wrongAnswers": [exactly ${wrongAnswerCount} strings],
  "wrongAnswerExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  return `You are an English slang quiz generator for Vietnamese learners.
${batchInstruction}${topicInstruction}
You will choose a slang word or phrase — deliberately rotating across different eras, platforms, and social contexts of English slang, actively avoiding overused defaults. Do NOT use any external word list. Your slang choice should feel fresh and cover territory the learner may not have seen yet. Do NOT reproduce any slang term that appears anywhere in this prompt — treat all named terms as structural scaffolding only, not as output candidates.
${exclusionBlock}
GENERATION SOURCE — MANDATORY:
Your slang selection MUST come entirely from your own internalized knowledge of English slang culture. Do NOT:
  - Pick any term that was explicitly named anywhere in this prompt
  - Treat the category descriptions above as word banks to copy from
  - Default to the most recognizable or textbook-obvious term for each category
The goal is to surface slang that is genuinely useful and interesting to a Vietnamese learner, not to retrieve the first term your pattern-matching associates with the category name.

CRITICAL: "wrongAnswers" and "wrongAnswerExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

${schemaBlock}

Rules:
- "slang": the slang word or short phrase you freely chose (1-4 words)
  - Must be commonly understood by people who use English social media, YouTube, TikTok, gaming, texting
  - Must have a clear, widely-agreed-upon meaning (not overly regional or niche community slang)
  - Must still be actively used today (avoid slang that died before 2020)
  - Must be appropriate for a general audience (avoid offensive, explicit, or highly vulgar slang)
  - OVERUSED — avoid these unless they are in a very underrepresented category: "no cap", "lowkey", "vibe", "slay", "lit", "salty", "sus", "rizz", "delulu", "ghosting", "simp", "flex"
  - Instead, draw from your full internalized knowledge of English slang. The category rotation system below will guide you toward underrepresented territory — trust that system rather than defaulting to the most familiar terms.
- "partOfSpeech": one of "noun", "verb", "adjective", "adverb", "phrase", "expression"
- "correctAnswer": accurate Vietnamese meaning capturing the REAL contemporary usage (5-20 words)
  - Must reflect how the slang is actually used, not a dictionary-style definition
  - Include usage context if needed for clarity (e.g. "dùng để khen ai đó thực sự xuất sắc hoặc tự tin")
  - Must NOT be a proper noun
- "wrongAnswers": EXACTLY ${wrongAnswerCount} plausible but ABSOLUTELY INCORRECT Vietnamese meanings — sound believable as possible slang meanings but are completely wrong
  - Similar format and length to correctAnswer
  - Must NOT overlap with correctAnswer in any context or interpretation
  - Must NOT be a paraphrase, sub-meaning, or related aspect of the correct meaning

  MANDATORY SELF-VERIFICATION — before finalizing each wrong answer, ask:
  "Is there any context where this Vietnamese meaning could describe what this slang actually means?"
  If YES or MAYBE → reject and replace.
  Every wrong answer must pass this check with a definitive NO.

- "wrongAnswerExplanations": for EACH wrong answer, explain in 1 sentence (friendly Vietnamese) WHY it is wrong — EXACTLY ${wrongAnswerCount} items
  - Same count and order as wrongAnswers
  - Required format: "[Nghĩa X] nói về [mô tả X], còn '[slang}' thực ra có nghĩa là [đúng] — [lý do cụ thể tại sao hai nghĩa này không thể trùng]."
  - Must clearly explain the semantic conflict, not just say "nghĩa khác nhau"
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "explanation": 1-2 sentences in casual Vietnamese
  - Sentence 1: the real meaning + typical usage context (who uses it, where: social media, gaming, texting, etc.)
  - Sentence 2 (optional): origin, or a common Vietnamese equivalent/phrase if one exists
  - Do NOT include an example sentence here
  - Do NOT use markdown formatting (no **bold**, no *italic*)
- "exampleSentence": natural English sentence using the slang as it would appear in texting, social media captions, or casual spoken conversation
  - Must feel authentic — not a formal textbook sentence
  - Show it used naturally in context a Vietnamese learner would actually encounter
- "exampleTranslation": natural Vietnamese translation of exampleSentence

SLANG SELECTION — DIVERSITY-FIRST SYSTEM:

SLANG CATEGORY ROTATION — select slang from the category LEAST represented in the recent exclusion list. Pick from ONE of these categories:
  CAT 1 — Authenticity & truth-telling
  Slang used to emphasize you are being completely honest — swearing on your sincerity, stressing what you said is not exaggerated or made-up. Functions like "I swear" or "no lie." Typically appears at the end of a statement to reinforce credibility.

  CAT 2 — Reactions & emotional response
  Slang for expressing strong emotional reactions — laughing uncontrollably, being shocked, overwhelmed, or distressed. Often hyperbolic. Covers both positive overwhelm (hilarity) and negative overwhelm (distress, cringe, being shaken).

  CAT 3 — Social dynamics & people types
  Slang for labeling how people behave socially — archetypes, behavior patterns, parasocial dynamics, how someone presents themselves to others online or in real life. Often used to call someone out or classify their social energy.

  CAT 4 — Quality & performance judgment
  Slang for rating how good or bad something (or someone's performance) is — excellence, mediocrity, failure, exceeding expectations. Used to pass verdict on music, food, sports plays, content, or any kind of output.

  CAT 5 — Online culture & internet behavior
  Slang native to internet and social media environments — platform-specific phenomena, dynamics of online discourse, coping with reality online, going viral, being overly chronically online. Describes behaviors or situations that only make sense in digital contexts.

  CAT 6 — Appearance, vibe & aesthetics
  Slang about how someone looks, the energy they project, or their personal style. Covers fashion, physical presentation, mood, and the intangible "aura" or aesthetic identity a person or thing conveys.

  CAT 7 — Gaming & competitive slang
  Slang originating in gaming communities that has crossed over into general everyday use. Covers skill levels, performance states, tactics, in-game actions, winning and losing dynamics, and the emotional experience of competitive play.

  CAT 8 — Dating & attraction
  Slang about romantic and interpersonal dynamics — attraction triggers, relationship stages, red and green signals, manipulation patterns, and the modern vocabulary of dating in the smartphone/app era.

Selection process:
1. Look at the excluded slang list → identify which categories they belong to (annotations provided above).
2. Choose the category with ZERO or fewest recent terms — this is already indicated in the DIRECTIVE above.
3. From that category, pick a term that is interesting and educational but not the most obvious default.
4. Must still satisfy: commonly understood, not offensive, actively used since 2020.
5. Prefer slang that reveals something genuinely interesting about English pop culture to Vietnamese learners.

Example output structure (with exactly ${wrongAnswerCount} wrong answers):
{
  "slang": "<the slang term or phrase you selected>",
  "partOfSpeech": "<noun|verb|adjective|adverb|phrase|expression>",
  "correctAnswer": "<Vietnamese meaning, 5–20 words, reflecting real contemporary usage>",
  "wrongAnswers": ${JSON.stringify(wrongAnswers, null, 2)},
  "wrongAnswerExplanations": ${JSON.stringify(wrongExplanations, null, 2)},
  "explanation": "<1–2 sentences casual Vietnamese: real meaning + usage context (who uses it, where), optionally origin or Vietnamese equivalent>",
  "exampleSentence": "<natural English sentence in texting/social media/casual speech register>",
  "exampleTranslation": "<natural Vietnamese translation of exampleSentence>"
}`;
}
