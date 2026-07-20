import type { DifficultyContext } from './vocab-prompt';

export interface ParagraphQuestion {
  paragraph: string; // 4–7 câu EN, coherent, có topic context nếu được cung cấp
  correctStatement: string; // 1 nhận định ĐÚNG, có thể verify trực tiếp từ đoạn văn
  wrongStatements: string[]; // EXACTLY optionCount-1 nhận định SAI 100%
  wrongStatementExplanations: string[]; // VN: giải thích tại sao từng wrongStatement sai, same order
  explanation: string; // 1–2 câu VN: tại sao correctStatement đúng + dẫn chứng cụ thể trong đoạn
  translation: string; // Dịch toàn bộ đoạn văn sang VI (single string, no literal newlines)
}

export function buildParagraphPrompt(
  wrongAnswerCount: number,
  options?: { count?: number; topic?: string; excludeWords?: string[] }
): string {
  const count = options?.count ?? 1;
  const topic = options?.topic;

  const batchInstruction =
    count > 1
      ? `
BATCH GENERATION — ${count} QUESTIONS REQUIRED:
Generate EXACTLY ${count} independent questions as a "questions" array.

Each question MUST independently satisfy ALL rules in this prompt as if generated alone:
  - Write a completely different paragraph for each item (different scenario, characters, and facts)
  - Perform the full SELF-VERIFICATION PROTOCOL for EACH item separately
  - Each wrongStatement must use a different tactic than the other wrongStatements in that item
  - Across all items, vary the paragraph scenario and domain

UNIQUENESS (in addition to individual quality):
  - No two items share the same paragraph scenario, setting, or main topic
  - No two items use the same distractor tactics in the same order
  - Vary the register: some paragraphs narrative, some descriptive, some informational

COMMON BATCH FAILURES — avoid:
  - Writing shallow paragraphs for items 2–${count}
  - Reusing the same distractor tactic combinations across items
  - Incorrect statement that is technically partially true from an unusual angle
  - Forgetting to run SELF-VERIFICATION for each item independently
`
      : '';

  const topicInstruction = topic
    ? `
TOPIC LOCK — "${topic}":
This is a HARD CONSTRAINT, not a suggestion. The paragraph scenario MUST be anchored to the "${topic}" domain:
  - "paragraph": the setting, characters, and facts must clearly relate to "${topic}"
  - "correctStatement" and "wrongStatements": focus on facts within the "${topic}" context
  - "translation": translate the full paragraph faithfully
Examples of topic-to-scenario mapping:
  "Travel" → airport check-in, hotel stay, sightseeing trip, currency exchange
  "Food" → cooking a meal, visiting a restaurant, grocery shopping, a food festival
  "Health" → doctor visit, exercise routine, managing stress, taking medication
  "Technology" → setting up a device, using an app, online shopping, a software project
  "School" → studying for exams, a school project, library visit, classroom discussion
  "Work" → a job interview, a team meeting, completing a work task, office life
Note: The distractor tactics for wrongStatements are NOT subject to the topic constraint — use whatever tactic makes the strongest distractor.
`
    : '';

  const schemaBlock =
    count > 1
      ? `Return ONLY valid JSON matching: { "questions": [array of ${count} objects matching schema below] }

Each object schema (no markdown, no extra text):
{
  "paragraph": string,
  "correctStatement": string,
  "wrongStatements": [exactly ${wrongAnswerCount} strings],
  "wrongStatementExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "translation": string
}`
      : `Return ONLY valid JSON (no markdown, no extra text):
{
  "paragraph": string,
  "correctStatement": string,
  "wrongStatements": [exactly ${wrongAnswerCount} strings],
  "wrongStatementExplanations": [exactly ${wrongAnswerCount} strings],
  "explanation": string,
  "translation": string
}`;

  return `You are a reading comprehension quiz generator for Vietnamese English learners.
${batchInstruction}${topicInstruction}
Write a short English paragraph (4–7 sentences), then create exactly 1 correct statement and ${wrongAnswerCount} incorrect statements about it. The learner must identify the ONE true statement.

CRITICAL: "wrongStatements" and "wrongStatementExplanations" must each contain EXACTLY ${wrongAnswerCount} items.

${schemaBlock}

─── DISTRACTOR TACTICS — assign one different tactic per wrongStatement ─────

Each wrongStatement must use a DIFFERENT tactic. Do NOT repeat the same tactic twice within one question.

1. DETAIL_SWAP — Change a specific detail (number, name, place, characteristic) to a different value.
   Example: paragraph says "Maria visited Paris" → wrong: "Maria visited Rome"
   Rule: The swapped detail must be clearly different from what the paragraph states — not close enough to be ambiguous.

2. NEGATION_FLIP — Negate something explicitly stated as true in the paragraph.
   Example: paragraph says "The project succeeded" → wrong: "The project failed"
   Rule: The negated fact must be directly stated in the paragraph, not implied.

3. CAUSAL_REVERSAL — Swap the cause and effect of a stated relationship.
   Example: paragraph says "Heavy rain caused the cancellation" → wrong: "The cancellation caused the heavy rain"
   Rule: Only apply when the paragraph explicitly states a clear causal link.

4. SCOPE_DISTORTION — Exaggerate or reduce the scope of a stated fact.
   Example: paragraph says "some students passed" → wrong: "all students passed" OR "no students passed"
   Rule: The distortion must clearly contradict the paragraph's stated scope.

5. ABSENT_INFERENCE — Add a plausible-sounding detail that is NOT mentioned anywhere in the paragraph.
   Example: paragraph describes a trip's outcome but NOT the reason for going → wrong: "She went on the trip for work reasons"
   Rule: The fabricated detail must be completely absent from the paragraph — not implied or hinted at.

6. TIME_SHIFT — Misrepresent the tense or time order of an event.
   Example: paragraph says "the store will open next week" → wrong: "the store has already opened"
   Rule: The time shift must clearly contradict what the paragraph states about timing.

Selection rule: If you have ${wrongAnswerCount} wrong statements, choose ${wrongAnswerCount} DIFFERENT tactics from the list above. If there are more tactics than needed, choose the ones that produce the most clearly-wrong-but-plausible distractors for this specific paragraph.

─── RULES ───────────────────────────────────────────────────────────────────

"paragraph":
- 4–7 coherent English sentences about a realistic everyday scenario
- Include specific, verifiable facts (names, numbers, actions, outcomes) — these become the basis for statements
- Vary the scenario: use the SCENARIO POOL below. Do NOT default to the same type of story every time.
- Keep language at a natural register appropriate for Vietnamese learners (clear, not overly literary)
- Do NOT include any questions or statements that look like quiz options

"correctStatement":
- Must be DIRECTLY verifiable from an explicit sentence in the paragraph — no inference required
- Must be phrased differently from the paragraph (do not copy a sentence verbatim)
- Must be unambiguously true — cannot be argued against using any part of the paragraph

"wrongStatements":
- EXACTLY ${wrongAnswerCount} statements, each using a different tactic from the list above
- Each must be CLEARLY false when checked against the paragraph — not "true from a certain angle"
- Each must look plausible at first glance (good distractors — not obviously silly)
- Must be phrased similarly to correctStatement in length and style so all options look comparable
- No wrong statement can accidentally be true or partially true

"wrongStatementExplanations":
- EXACTLY ${wrongAnswerCount} short Vietnamese explanations, same order as wrongStatements
- For each: name which specific sentence or fact in the paragraph contradicts this statement
- Format: "[Statement này sai vì...] + [chỉ ra câu/chi tiết cụ thể trong đoạn văn mâu thuẫn]"
- Do NOT say "thông tin không có trong đoạn văn" as the only reason — cite what IS in the paragraph
- Do NOT use markdown formatting

"explanation":
- 1–2 sentences in natural Vietnamese
- Explain WHY correctStatement is true — cite the specific sentence or fact in the paragraph that confirms it
- Format: "[Nhận định đúng vì...] + [dẫn chứng cụ thể từ đoạn văn]"
- Do NOT use markdown formatting

"translation":
- Natural Vietnamese translation of the full paragraph
- Single continuous string — no literal newlines inside
- Numbers unchanged

─── SELF-VERIFICATION PROTOCOL — execute BEFORE writing JSON ────────────────

Step 1 — List every explicit fact in your paragraph: who, what, where, when, how many, what happened.
Step 2 — For correctStatement: find the EXACT sentence that confirms it → if none exists → rewrite the statement.
Step 3 — For each wrongStatement: check if it is 100% false → if there is ANY interpretation where it could be true → change the tactic or rewrite.
Step 4 — Confirm each wrongStatement uses a DIFFERENT tactic.
Step 5 — Confirm "wrongStatements" has exactly ${wrongAnswerCount} items and "wrongStatementExplanations" has exactly ${wrongAnswerCount} items.

Only output JSON after all 5 steps pass.

─── SCENARIO POOL — rotate freely, never repeat the same scenario twice ─────

Morning commute & public transport | Home cooking & meal prep | School project & study session |
Gym workout & fitness tracking | Online shopping & delivery | Pocket money & savings |
Part-time job & earning | Pet care & vet visit | Laundry & household chores |
Café visit & loyalty rewards | Birthday party planning | Movie night & streaming |
Library & book borrowing | Weekend hiking & outdoor | Hospital visit & recovery |
Office printing & work task | Travel booking & packing | Hotel check-in & service |
Supermarket run & budget | Art class & craft project | Cooking a new recipe |
Bakery & pre-order | Ride-hailing & commute cost | Gardening & plant care |
Book club & reading challenge | Package delivery & tracking | Subscription service |
Sports match & scoring | Science fair & experiment | History class & research |
Volunteer work & charity | Farming & harvest | Festival & cultural event |
Foreign exchange & travel | Wildlife & animal care | Tech setup & device |
Exam prep & school life | Team meeting & report | Home renovation project

─── EXAMPLE OUTPUT (${wrongAnswerCount} wrong statements) ─────────────────────────────────────

STRUCTURE ONLY — do NOT copy this scenario, names, or facts. Study ONLY the JSON structure and how each wrong statement maps to a different tactic.

{
  "paragraph": "Linh signed up for a photography workshop at her local community center last Saturday. The workshop ran for three hours and covered basic camera settings, lighting techniques, and composition rules. There were twelve participants in total, and each person received a printed guide to take home. The instructor, Mr. Tan, encouraged everyone to practice outdoors during golden hour. By the end of the session, Linh had taken over forty photos and felt much more confident about her new hobby.",
  "correctStatement": "Each participant received a printed guide at the end of the workshop.",
  "wrongStatements": [
    "The photography workshop lasted five hours.",
    "Linh attended the workshop on a weekday.",
    "Mr. Tan discouraged participants from practicing outdoors.",
    "Linh took fewer than twenty photos during the session."
  ].slice(0, ${wrongAnswerCount}),
  "wrongStatementExplanations": [
    "Sai vì đoạn văn nói workshop kéo dài ba tiếng (three hours), không phải năm tiếng — tactic: DETAIL_SWAP.",
    "Sai vì đoạn văn nói rõ workshop diễn ra vào thứ Bảy tuần trước (last Saturday), không phải ngày trong tuần — tactic: DETAIL_SWAP.",
    "Sai vì đoạn văn nói Mr. Tan khuyến khích (encouraged) mọi người luyện tập ngoài trời, hoàn toàn ngược lại với 'discouraged' — tactic: NEGATION_FLIP.",
    "Sai vì đoạn văn nói Linh chụp được hơn bốn mươi tấm ảnh (over forty photos), không phải dưới hai mươi — tactic: SCOPE_DISTORTION."
  ].slice(0, ${wrongAnswerCount}),
  "explanation": "Nhận định đúng vì đoạn văn nêu rõ: 'each person received a printed guide to take home' — xác nhận trực tiếp rằng mỗi người tham gia đều nhận được tài liệu in.",
  "translation": "Linh đăng ký tham gia một buổi workshop nhiếp ảnh tại trung tâm cộng đồng địa phương vào thứ Bảy tuần trước. Buổi workshop kéo dài ba tiếng và đề cập đến các cài đặt máy ảnh cơ bản, kỹ thuật ánh sáng và quy tắc bố cục. Có tổng cộng mười hai người tham gia và mỗi người nhận được một tài liệu in để mang về. Giảng viên, thầy Tân, khuyến khích mọi người luyện tập ngoài trời vào giờ vàng. Đến cuối buổi, Linh đã chụp được hơn bốn mươi tấm ảnh và cảm thấy tự tin hơn nhiều về sở thích mới của mình."
}`;
}
