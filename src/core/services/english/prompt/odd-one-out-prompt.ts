export interface OddOneOutQuestion {
  oddWord: string; // từ "lạc lõng" — đây là correctAnswer
  groupTheme: string; // mô tả ngắn bằng EN điểm chung của groupWords, e.g. "things you use to cook"
  groupWords: string[]; // EXACTLY optionCount-1 từ thuộc cùng nhóm (wrongAnswers)
  groupWordExplanations: string[]; // VN giải thích nghĩa + chức năng thực tế của từng groupWord, same order
  explanation: string; // 2 câu VN: nhóm là gì + oddWord không thuộc vì sao (hoàn toàn, rõ ràng)
  exampleSentence: string; // câu EN dùng oddWord trong ngữ cảnh thường ngày
  exampleTranslation: string;
}

const EXAMPLE_GROUP_WORDS = ['spatula', 'whisk', 'ladle', 'colander'];
const EXAMPLE_GROUP_EXPLANATIONS = [
  'Spatula có nghĩa là cái phới. Đây là dụng cụ nhỏ dùng để lật thức ăn khi đang chiên hoặc nướng trên chảo.',
  'Whisk có nghĩa là cái đánh trứng. Người ta dùng nó để khuấy đều trứng, kem hoặc bột khi chuẩn bị món ăn.',
  'Ladle có nghĩa là cái muôi. Đây là dụng cụ cán dài dùng để múc canh, súp hoặc nước sốt ra bát.',
  'Colander có nghĩa là cái rổ lọc nước. Người ta dùng nó để ráo nước mì, rau hoặc thức ăn vừa luộc xong.'
];

export function buildOddOneOutPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const excludeWords = options?.excludeWords;
  const exampleGroupWords = EXAMPLE_GROUP_WORDS.slice(0, wrongAnswerCount);
  const exampleGroupExplanations = EXAMPLE_GROUP_EXPLANATIONS.slice(0, wrongAnswerCount);

  const batchInstruction =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Perform full group selection and 3-step oddWord check for each item separately
  - Each item must pass the FINAL SELF-CHECK (zero-overlap verification) independently
  - Each item must have specific groupWordExplanations — never abbreviated or reused patterns
  - Each item must have a fresh exampleSentence for its oddWord in a different daily-life scenario

UNIQUENESS (in addition to individual quality):
  - No two items share the same groupTheme or a closely related theme
  - No two items use the same oddWord or a semantically similar word
  - Vary the domain of groupWords across items (CAT-A through CAT-L)

COMMON BATCH FAILURES — avoid:
  - Cutting corners on items 2–${count} after spending effort on item 1
  - Choosing groupThemes from the same domain repeatedly
  - Reusing the same oddWord domain across items
  - Writing vague groupWordExplanations that could apply to any item
`
      : '';
  const topicInstruction = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following fields MUST be anchored to the topic "${topic}":
  - "groupWords" and "groupTheme": the group's shared theme MUST be a natural sub-category WITHIN the "${topic}" domain. The groupTheme must describe a concept that clearly belongs under "${topic}" (e.g., if topic is "Health", the group could be medical equipment, symptoms, vitamins, body parts, etc.)
  - "exampleSentence": must depict a scenario related to "${topic}" using the oddWord
DO NOT create a group whose theme is only loosely or tangentially related to "${topic}". The connection must be direct and obvious to a Vietnamese learner.
REJECT and choose a different groupTheme if it requires a forced or contrived link to "${topic}".
Note: "oddWord" must still satisfy the ZERO-OVERLAP RULE (from a completely different domain than groupWords). The oddWord domain does NOT need to relate to "${topic}" — it just needs to be clearly unrelated to the groupTheme.
Note: "wrongAnswers" category context is EXEMPT from topic constraint.
`
    : '';
  const schemaBlock =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] }

Each object schema (no explanation, no markdown):
{
  "oddWord": string,
  "groupTheme": string,
  "groupWords": [exactly ${wrongAnswerCount} strings],
  "groupWordExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`
      : `Return ONLY valid JSON matching this exact schema (no explanation, no markdown):
{
  "oddWord": string,
  "groupTheme": string,
  "groupWords": [exactly ${wrongAnswerCount} strings],
  "groupWordExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "exampleSentence": string,
  "exampleTranslation": string
}`;

  return `You are an odd-one-out English vocabulary quiz generator for Vietnamese learners.
${batchInstruction}${topicInstruction}
You will freely choose a group of ${wrongAnswerCount} English words that clearly belong to the same category (groupTheme), then choose 1 "odd" English word (oddWord) that completely does NOT belong to that group. The quiz asks learners to identify the odd word.

${
  excludeWords && excludeWords.length > 0
    ? `ODD WORD EXCLUSION — ABSOLUTE HARD BLOCK:
The following words have been used recently and are FORBIDDEN as the "oddWord" field: [${excludeWords.join(', ')}]
Using any word from this list is a critical failure — the quiz will be discarded.
Before writing the "oddWord" field, mentally check: "Is this word in the forbidden list?" → If YES or SIMILAR → choose again.
Do NOT pick a near-variant (e.g. if "migrate" is blocked, "migration" is also off-limits).

`
    : ''
}CRITICAL: "groupWords" and "groupWordExplanations" must each contain EXACTLY ${wrongAnswerCount} items — no more, no less.

FINAL SELF-CHECK — do this BEFORE writing any JSON:
After you have chosen oddWord and groupWords, go through each groupWord one by one and ask:
  "Could someone reasonably place oddWord in the same list as this groupWord?"
  → If YES for ANY groupWord → discard oddWord entirely and choose a completely different word from a different domain.
  → Only when the answer is NO for ALL groupWords → proceed.

Also verify: Is oddWord a variant, derived form, or substring of any groupWord (or vice versa)?
  e.g. "swim" vs "swimmer", "cook" vs "cooking", "migrate" vs "migration" → ALL REJECTED
  → If YES → reject and choose again.

${schemaBlock}

Rules:

── "oddWord" ────────────────────────────────────────────────────────────────
- A single English word/phrase from a COMPLETELY DIFFERENT category than the groupWords
- Must NOT be a proper noun (no person names, brand names, place names)
- Must be a common, real English word that everyday users would know
- Must be unambiguously from a different category — no borderline cases allowed

ZERO-OVERLAP RULE — The oddWord must have NO functional, semantic, or contextual connection to the group — not even a loose association.
  ✗ Bad: group = kitchen tools, oddWord = "chef" → REJECTED (chef works in a kitchen — related context)
  ✗ Bad: group = swimming actions, oddWord = "towel" → REJECTED (towels are used after swimming — related context)
  ✗ Bad: group = musical instruments, oddWord = "concert" → REJECTED (concerts involve instruments — same context)
  ✓ Good: group = kitchen tools, oddWord = "nostalgic" → ACCEPTED (zero connection to kitchen or tools)
  ✓ Good: group = swimming actions, oddWord = "audit" → ACCEPTED (zero connection to swimming or water)

MANDATORY 3-STEP CHECK before finalizing oddWord:
  Step 1: "Does this word belong to the groupTheme directly?" → If YES → reject and choose again
  Step 2: "Is this word commonly associated with, used in, or connected to the group's context?" → If YES → reject and choose again
  Step 3: "Could a native English speaker argue any reasonable connection between this word and the group?" → If YES → reject and choose again
  Only proceed if all 3 steps answer NO.

MORE border case examples to avoid:
  ✗ Bad: group = baking ingredients (flour, sugar, yeast), oddWord = "oven" → REJECTED (ovens are used for baking — same context)
  ✗ Bad: group = hiking gear (compass, backpack, trekking pole), oddWord = "trail" → REJECTED (trails are where hikers walk — same context)
  ✗ Bad: group = emotions (anxious, elated, melancholic), oddWord = "therapist" → REJECTED (therapists deal with emotions — same context)
  ✗ Bad: group = computer parts (CPU, RAM, motherboard), oddWord = "programmer" → REJECTED (programmers use computers — same context)
  ✓ Good: group = baking ingredients (flour, sugar, yeast), oddWord = "negotiate" → ACCEPTED (zero connection to baking)
  ✓ Good: group = hiking gear (compass, backpack, trekking pole), oddWord = "dissolve" → ACCEPTED (zero connection to hiking)

── "groupTheme" ─────────────────────────────────────────────────────────────
- Short English phrase describing what the groupWords share in common (e.g. "kitchen utensils", "actions you do at a gym", "emotions that feel overwhelming")
- Must be specific enough to clearly exclude the oddWord
- Used internally only — do NOT copy this label into explanations or explanation field

── "groupWords" ─────────────────────────────────────────────────────────────
- EXACTLY ${wrongAnswerCount} English words/phrases that clearly belong to groupTheme
- Must be real, common English words
- Must NOT include oddWord
- Must NOT be proper nouns
- Each word must fit groupTheme with no ambiguity — avoid words that could belong to multiple categories

── "groupWordExplanations" ──────────────────────────────────────────────────
- For EACH groupWord, explain in plain, natural Vietnamese what the word means and what it refers to in real life — EXACTLY ${wrongAnswerCount} items
- Same count and order as groupWords
- Required format: "[Từ X] có nghĩa là [nghĩa VN ngắn gọn, dễ hiểu]. [1 câu giải thích nó là gì hoặc dùng để làm gì trong thực tế, cụ thể và dễ hình dung]."
- IMPORTANT: Do NOT mention the groupTheme label or category name — explain the word's meaning and function directly
- IMPORTANT: Do NOT say "thuộc nhóm...", "là một loại...", or reference the category — just explain what the word is
- Must be friendly, concrete, and easy for a Vietnamese learner to understand
- Do NOT use markdown formatting (no **bold**, no *italic*)

  Examples of GOOD groupWordExplanations:
  - "Spatula có nghĩa là cái phới. Đây là dụng cụ nhỏ dùng để lật thức ăn khi đang chiên hoặc nướng trên chảo."
  - "Hibernate có nghĩa là ngủ đông. Một số loài động vật làm điều này suốt mùa đông — chúng ngủ sâu và không ăn uống gì."
  - "Bandwidth có nghĩa là băng thông. Đây là lượng dữ liệu tối đa có thể truyền qua mạng internet trong một khoảng thời gian."

  Examples of BAD groupWordExplanations (do NOT do this):
  - "Spatula thuộc nhóm kitchen utensils vì nó là dụng cụ nhà bếp." ← references category name
  - "Whisk là một loại kitchen tool." ← vague and references category

── "explanation" ────────────────────────────────────────────────────────────
- Exactly 2 sentences in friendly Vietnamese
- Sentence 1: Describe what the group words have in common using plain language — describe their function or nature, NOT by listing the groupTheme label. Use phrasing like "Ba từ còn lại đều là... / đều nói về... / đều dùng để..."
- Sentence 2: Explain what oddWord means in simple Vietnamese, then clearly state why it has NOTHING to do with the group — be specific, not vague
- Do NOT mention the groupTheme label or category name (e.g. don't say "kitchen utensils" — say "dụng cụ nấu ăn" or describe their function)
- Do NOT include an example sentence here
- Do NOT use markdown formatting (no **bold**, no *italic*)

  Example of GOOD explanation:
  "Spatula, whisk và ladle đều là những dụng cụ cầm tay được dùng trong bếp để xử lý thức ăn khi nấu nướng. Còn melancholic là tính từ mô tả trạng thái cảm xúc u buồn, hoài nhớ — đây là một từ thuộc về cảm xúc con người, hoàn toàn không liên quan đến đồ vật hay việc nấu ăn."

  Example of BAD explanation (do NOT do this):
  "Ba từ kia đều thuộc nhóm kitchen utensils. Melancholic không phải kitchen utensil." ← uses category label, too vague

── "exampleSentence" ────────────────────────────────────────────────────────
- One natural English sentence using "oddWord" in a daily-life context
- Friends, school, work, social media, travel, hobbies, relationships, etc.
- Must NOT be a textbook-style sentence
- Must use "oddWord" naturally and meaningfully

── "exampleTranslation" ─────────────────────────────────────────────────────
- Natural Vietnamese translation of exampleSentence

WORD SELECTION — DIVERSITY-FIRST SYSTEM:

You MUST freely choose your own words — do NOT copy words from the example lists below. The examples below show the scope and style of each domain only. Choose fresh, non-obvious words that meet all requirements.

DOMAIN ROTATION — identify which domain is LEAST represented in the recent exclusion list, then choose groupWords from that domain and oddWord from a completely different domain.

  CAT-A — Kitchen & cooking tools/actions (e.g. spatula, colander, ladle)
  CAT-B — Emotions & psychological states (e.g. nostalgic, apprehensive, elated)
  CAT-C — Sports & competitive games actions/roles (e.g. referee, penalty, fumble)
  CAT-D — Animal behavior & wildlife (e.g. hibernate, nocturnal, scavenger)
  CAT-E — Technology & computing (e.g. bandwidth, firmware, latency)
  CAT-F — Clothing & fashion (e.g. lapel, denim, embroidery)
  CAT-G — Transportation & travel (e.g. commute, itinerary, throttle)
  CAT-H — Academic & professional life (e.g. internship, dissertation, residency)
  CAT-I — Food preparation & cooking methods (e.g. ferment, garnish, caramelize)
  CAT-J — Music & performing arts (e.g. tempo, choreograph, percussion)
  CAT-K — Body, health & medicine (e.g. inflammation, metabolism, rehabilitation)
  CAT-L — Social & family relationships (e.g. sibling, mentor, acquaintance)

Do NOT copy words directly from these examples — they are scope guides only. Choose your own fresh, appropriate words from the domain.

Banned groupTheme types: basic colors, single-digit numbers, days of week, months, single alphabet letters.

Selection process:
1. Look at the excluded words list → identify which domains they belong to.
2. Choose the domain with ZERO or fewest recent words.
3. From that domain, choose ${wrongAnswerCount} fresh words that clearly fit and are unambiguous.
4. Choose an oddWord from a COMPLETELY DIFFERENT domain that has zero connection to the group's domain.
5. Prefer words in the mid-difficulty range — well-known by everyday English users but not trivially simple (cat, red, big).

Example output (with exactly ${wrongAnswerCount} group words):
{
  "oddWord": "melancholic",
  "groupTheme": "kitchen utensils",
  "groupWords": ${JSON.stringify(exampleGroupWords, null, 2)},
  "groupWordExplanations": ${JSON.stringify(exampleGroupExplanations, null, 2)},
  "explanation": "Spatula, whisk và ladle đều là những dụng cụ cầm tay được dùng trong bếp để xử lý thức ăn khi nấu nướng. Còn melancholic là tính từ mô tả trạng thái cảm xúc u buồn, hoài nhớ — đây là từ thuộc về cảm xúc con người, hoàn toàn không liên quan đến đồ vật hay việc nấu ăn.",
  "exampleSentence": "She felt melancholic listening to that old song — it reminded her of her childhood.",
  "exampleTranslation": "Cô ấy cảm thấy u buồn khi nghe bài hát cũ đó — nó gợi nhớ thời thơ ấu của cô."
}`;
}
