import type { DifficultyContext } from './vocab-prompt';

export interface ReadingQuestion {
  distractorTactic: string; // tên tactic được dùng, e.g. "TEMPORAL_SHIFT"
  context: string; // 4-5 câu EN paragraph, KHÔNG chứa câu hỏi
  questionSentence: string; // Câu hỏi tính toán cuối cùng
  correctAnswer: number; // Số nguyên dương, kết quả chính xác của phép tính
  wrongAnswers: number[]; // EXACTLY optionCount-1 phần tử, số nguyên dương, distinct
  translation: string; // Dịch toàn bộ (context + questionSentence) sang tiếng Việt
  explanation: string; // 1 câu VN: chỉ số nào dùng + phép tính dạng "A × B = C"
}

const VALID_TACTICS = [
  'SUBSET_AMBIGUITY',
  'TEMPORAL_SHIFT',
  'CONDITIONAL_EXCLUSION',
  'UNIT_MISMATCH',
  'PARTIAL_TOTAL',
  'ACCUMULATED_ACTION',
  'SEMANTIC_NEGATION',
  'PARALLEL_SELECTIVE'
] as const;

export type DistractorTactic = (typeof VALID_TACTICS)[number];
export { VALID_TACTICS };

export function buildReadingPrompt(
  wrongAnswerCount: number,
  engLevel: DifficultyContext['engLevel'],
  options?: { count?: number; topic?: string }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;
  const levelGuide: Record<DifficultyContext['engLevel'], string> = {
    A1: 'Very simple vocabulary, short sentences, numbers under 50. Prefer CONDITIONAL_EXCLUSION or UNIT_MISMATCH.',
    A2: 'Common vocabulary, numbers up to 100. Prefer TEMPORAL_SHIFT or PARALLEL_SELECTIVE.',
    B1: 'Intermediate vocabulary, numbers up to 150. Prefer SUBSET_AMBIGUITY or ACCUMULATED_ACTION.',
    B2: 'Natural vocabulary with idioms fine, numbers up to 200. Prefer PARTIAL_TOTAL or SEMANTIC_NEGATION.'
  };

  const batchInstruction =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Execute the full 7-step MATH COMPUTATION PROTOCOL for EACH item independently
  - Each item must pass all 6 FINAL SELF-CHECK points before being written
  - Each item must use a different distractor tactic
  - Each item must use a completely different scenario from the SCENARIO POOL

UNIQUENESS (in addition to individual quality):
  - No two items share the same scenario type or setting
  - No two items use the same distractor tactic
  - Vary the character type, time of day, and activity across items

COMMON BATCH FAILURES — avoid:
  - Skipping or shortcutting the math verification for items 2–${count}
  - Using the same scenario theme across multiple items (e.g., all school-related)
  - Using the same distractor tactic twice
  - Writing correctAnswer without completing all 7 computation steps for that specific item
`
      : '';
  const topicInstruction = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The following field MUST be anchored to the topic "${topic}":
  - "context": the reading passage scenario must be set in a "${topic}" context. Select from the SCENARIO POOL only those scenarios that naturally fit the "${topic}" domain. If no scenario in the pool matches exactly, adapt the closest one to fit "${topic}".
Examples of topic-to-scenario mapping:
  "Travel" → Morning commute, Weekend hiking, Foreign travel & currency exchange, Hotel stay & room service
  "Food" → Home cooking & meal prep, Café order & loyalty points, Bakery & pre-order pickup, Supermarket self-checkout
  "Health" → Hospital appointment & medicine, Gym workout & fitness tracking, Pet feeding & care
  "Technology" → Mobile phone & data usage, Tech setup & device usage, Streaming & subscription plan
  "School" → School homework & study session, Library borrowing & returns, School exam & test prep
  "Shopping" → Pocket money & small purchases, Supermarket self-checkout, Savings & weekly budget
Note: The distractor tactic, math computation, and wrongAnswers are NOT subject to the topic constraint — choose whichever tactic is appropriate for the level.
`
    : '';
  const schemaBlock =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] }

Each object schema (no markdown, no extra text):
{
  "distractorTactic": string,
  "context": string,
  "questionSentence": string,
  "correctAnswer": number,
  "wrongAnswers": [exactly ${wrongAnswerCount} integers],
  "translation": string,
  "explanation": string
}`
      : `Return ONLY valid JSON (no markdown, no extra text):
{
  "distractorTactic": string,
  "context": string,
  "questionSentence": string,
  "correctAnswer": number,
  "wrongAnswers": [exactly ${wrongAnswerCount} integers],
  "translation": string,
  "explanation": string
}`;

  return `You are a reading + mental math quiz generator for Vietnamese English learners.
${batchInstruction}${topicInstruction}
Generate a 4-5 sentence English paragraph using ONE distractor tactic, followed by a one-step mental math question.

Level: ${engLevel} — ${levelGuide[engLevel]}

CRITICAL: "wrongAnswers" must have EXACTLY ${wrongAnswerCount} integers.

${schemaBlock}

─── MATH COMPUTATION PROTOCOL — EXECUTE BEFORE WRITING JSON ────────────────

You MUST complete all 7 steps mentally before filling in any JSON field:

Step 1 — List ALL numbers in your paragraph. Label each: what does it represent in the story?
Step 2 — Identify which numbers are the INPUTS to the question (relevant to the calculation).
Step 3 — Identify which numbers are DISTRACTORS (present in the story but NOT needed for the answer).
Step 4 — Write the exact calculation chain: "A ○ B = C" (use +, -, ×, or ÷ only). C must be a positive integer.
Step 5 — correctAnswer = C from Step 4. This is the ONLY valid value. Do not write any other number.
Step 6 — explanation must reproduce the formula from Step 4 in Vietnamese. The formula shown MUST equal correctAnswer.
Step 7 — Each wrongAnswer must come from a named mistake in the calculation (e.g., used the pre-change total, forgot to subtract, stopped one step early).

Do NOT fill in "correctAnswer" or "explanation" until you have completed all 7 steps.

─── DISTRACTOR TACTICS — choose ONE, rotate across calls ───────────────────────

1. SUBSET_AMBIGUITY — State a total, then split it into sub-groups across multiple sentences. Ask about one sub-group.
   Trap answer: the full total before splitting.
   Example: "The box has 24 crayons. Half are red, the rest split equally between blue and green." → ask for blue count → trap: 24 or 12

2. TEMPORAL_SHIFT — Give an initial count, then 1-2 change events (sold, received, used, lost). Ask for the final count.
   Trap answer: the initial count before changes.
   Example: "Had 30 roses → sold 18 → received 12." → ask current count → trap: 30 or 18

3. CONDITIONAL_EXCLUSION — State a total, then exclude part of it with "but/however/except/only". Ask for the remaining count.
   Trap answer: the full total before exclusion.
   Example: "12 players registered, but 3 are injured." → ask available players → trap: 12

4. UNIT_MISMATCH — Describe quantities in two units of the same item (boxes vs. items, packs vs. pieces). Ask for the smaller unit.
   Trap answer: the count in the larger unit (e.g. number of boxes instead of total items).
   Example: "Bought 4 packs of 6 pencils each." → ask total pencils → trap: 4

5. PARTIAL_TOTAL — Apply action to only a fraction of a group (half, one-third, 2 out of 5). Ask for the result of that fraction only.
   Trap answer: applying the action to the full group instead of the fraction.
   Example: "20 students, half chose swimming, each needs 2 towels." → ask towels needed → trap: 20×2=40 instead of 10×2=20

6. ACCUMULATED_ACTION — Same action appears 3+ times across separate sentences with different numbers. Ask for the running total.
   Trap answer: the result of adding only the first two occurrences (missing the last one).
   Example: "Baked 15 in morning, 9 after lunch, 6 in evening." → ask total → trap: 15+9=24

7. SEMANTIC_NEGATION — State a quantity, then reduce it with "not all", "only X out of Y", "except". Ask for the actual amount.
   Trap answer: the original stated quantity before negation.
   Example: "Ordered 18 novels, only 2 out of every 3 arrived." → ask received count → trap: 18

8. PARALLEL_SELECTIVE — List several similar items with quantities, then a condition selects only some. Ask for the conditional total.
   Trap answer: summing all items instead of only the selected ones.
   Example: "Bought 4 apples, 3 mangoes, 5 bananas. Only the sweet ones are served." → ask selected fruit → trap: includes all

─── RULES ──────────────────────────────────────────────────────────────────────

"distractorTactic": The name of the tactic you chose (exactly one of the 8 above).

"context":
- 4-5 coherent English sentences
- Numbers: whole positive integers only
- Do NOT include the question
- VARY the scenario freely — rotate through the scenario pool below. Do NOT default to flower shops, grocery stores, or the scenario shown in the example.

DISTRACTOR QUALITY — this is the hardest part to get right:
- Every number or detail in the paragraph must feel like it BELONGS to the story — never obviously decorative or "filler"
- Misleading numbers should be the same unit/type as the answer (e.g. if the answer is "minutes", all distractors are also in minutes — not km, not people)
- The best distractors are numbers the reader USED in an earlier step of reasoning but should NOT use for the final answer (e.g. an intermediate value, a sub-total, a before-change amount)
- Avoid inserting a random "extra fact" that clearly has nothing to do with the question (like "the store opens at 8am" when asking about quantity)

"questionSentence":
- 1 clear question using the tactic: addition, subtraction, multiplication, OR division only
- Answer: positive integer 1–200, exactly ONE correct answer

"correctAnswer":
- MUST equal the result C from Step 4 of the MATH COMPUTATION PROTOCOL above
- Do NOT write this field until you have completed all 7 steps
- This value and the formula in "explanation" are derived from the SAME calculation — they must be identical

"wrongAnswers":
- EXACTLY ${wrongAnswerCount} distinct positive integers, none equal to correctAnswer or each other
- Each wrong answer MUST come from a specific, named arithmetic mistake:
  - trap-A: used the pre-change or pre-exclusion total (the initial number before any operation)
  - trap-B: partial calculation — stopped one step too early (missed the last event or fraction)
  - trap-C: applied the operation to the wrong group (full set instead of subset, or vice versa)
- At least 1 wrong answer must be a number that already appears explicitly in the context
- Remaining wrong answers: within ±5 to ±20 of correctAnswer, but each still traceable to a named misstep above

"translation":
- Natural Vietnamese of context + questionSentence combined, numbers unchanged
- Single continuous string — no literal newlines inside

"explanation":
- 1 short Vietnamese sentence
- MUST contain: which numbers you used, why you ignored the distractor numbers (name the trap), and the exact arithmetic formula "A ○ B = C"
- The formula shown here MUST produce correctAnswer. If it does not → your correctAnswer is wrong — fix correctAnswer to match.
- Think of this as the PROOF of correctAnswer. If the formula doesn't give correctAnswer, there is an error — fix it before outputting.
- Required format: "Dùng [relevant numbers], bỏ qua [distractor] vì [reason] — phép tính: A ○ B = C."

─── FINAL SELF-CHECK — do this BEFORE writing JSON ─────────────────────────

After composing your paragraph and question, verify each point:

1. List: "The numbers in my context are: [list them with labels]" — are all numbers story-relevant?
2. Compute: "My calculation is: [formula] = [result]"
3. Confirm: correctAnswer == [result] → if NO → fix correctAnswer
4. Confirm: the formula in explanation produces correctAnswer → if NO → fix explanation (or fix correctAnswer)
5. Confirm: each wrongAnswer comes from a named misstep (trap-A / trap-B / trap-C) → if NO → fix wrongAnswers
6. Confirm: no wrongAnswer equals correctAnswer → if YES → fix wrongAnswers

Only output JSON after all 6 checks pass.

─── SCENARIO POOL — pick a DIFFERENT scenario each call, NEVER the same as the example ────

Morning commute & public transport | Home cooking & meal prep | School homework & study session |
Gym workout & fitness tracking | Mobile phone & data usage | Pocket money & small purchases |
Online gaming & quests | Pet feeding & care | Laundry & household chores |
Café order & loyalty points | Birthday party planning | Movie night at home |
Library borrowing & returns | Weekend hiking & outdoor | Hospital appointment & medicine |
Office printing & supplies | Parking & fuel top-up | Hotel stay & room service |
Supermarket self-checkout | Art class & craft supplies | Savings & weekly budget |
Bakery & pre-order pickup | Ride-hailing & trip cost | Gardening & plant watering |
Book club & reading tracker | Delivery tracking & packages | Streaming & subscription plan |
Sports competition & scoring | Science experiment & lab | History lesson & timeline |
Volunteer work & charity | Farming & harvest | Festival & cultural event |
Foreign travel & currency exchange | Wildlife & animal care | Tech setup & device usage |
School exam & test prep | Office meeting & report | Construction & building project

─── DIVERSITY ENFORCEMENT ──────────────────────────────────────────────────────

Each response MUST feel like a completely different quiz from any previous one:
- Rotate through different scenarios from the pool above — do NOT repeat the scenario from the example
- Rotate through different distractor tactics
- Vary the setting (indoor/outdoor, solo/group, morning/evening)
- Vary the character (student, adult, parent, employee, traveler…)
- Vary sentence structures — avoid formulaic openings like "There were X items…"

─── EXAMPLE OUTPUT (ACCUMULATED_ACTION, ${wrongAnswerCount} wrong answers) ──────────────────

STRUCTURE ONLY — do NOT copy:
❌ Do NOT reuse: the scenario (dumpling-making), the character name (Lan), the numbers (12/9/8/29), the setting, the tactic, or any phrasing from this example.
✅ Study ONLY: the JSON field structure, the explanation proof format ("Dùng…, bỏ qua… — phép tính: A+B+C=D"), and how each wrongAnswer traces back to a named misstep.

Wrong answer derivation for this example (annotation — not part of JSON output):
  - 21 = 12+9 → trap-B: stopped after the first two batches, missed the evening fold
  - 24 = 12+12 → trap-C: confused tray capacity (12) with the afternoon fold count
  - 33 = 12+9+8+4 → trap-A: counted a number from yesterday's tray as part of today's total

{
  "distractorTactic": "ACCUMULATED_ACTION",
  "context": "Lan is helping her mom prepare dumplings for a family dinner. She folded 12 dumplings before lunch, then 9 more while watching TV in the afternoon. Just before dinner, she quickly folded another 8 to fill the last tray. Each tray holds exactly 12 dumplings and they already had one tray ready from yesterday.",
  "questionSentence": "How many dumplings did Lan fold today in total?",
  "correctAnswer": 29,
  "wrongAnswers": ${JSON.stringify([21, 24, 33].slice(0, wrongAnswerCount))},
  "translation": "Lan đang giúp mẹ làm bánh há cảo cho bữa tối gia đình. Cô gấp được 12 cái trước bữa trưa, rồi thêm 9 cái trong lúc xem TV buổi chiều. Ngay trước bữa tối, cô gấp nhanh thêm 8 cái nữa để đầy khay cuối. Mỗi khay đựng vừa đúng 12 cái và họ đã có sẵn một khay từ hôm qua. Hỏi: Hôm nay Lan gấp được tổng cộng bao nhiêu cái bánh há cảo?",
  "explanation": "Dùng 3 lần gấp của Lan hôm nay (12, 9, 8), bỏ qua khay từ hôm qua và sức chứa khay vì đó là thông tin nền — phép tính: 12 + 9 + 8 = 29."
}`;
}
