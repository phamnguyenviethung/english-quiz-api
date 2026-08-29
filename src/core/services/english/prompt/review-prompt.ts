import type { QuizType } from '../questionTypes';
import type { DifficultyContext } from './vocab-prompt';
import { QUIZ_TYPE_REVIEW_SPEC } from './review-type-spec';

export type ReviewContext = DifficultyContext & { topicName?: string | null };

// Chỉ phần mô tả level (KHÔNG lấy "EXPERT LEARNER MODE — MAXIMUM DIFFICULTY" của
// buildDifficultyInstruction — nó ép mọi câu phải khó tối đa, làm review sửa hỏng câu dễ).
const LEVEL_NOTE: Record<DifficultyContext['engLevel'], string> = {
  A1: 'beginner — very common, everyday words (top ~1000 most frequent). Simple, direct items are expected.',
  A2: 'elementary — common words used in daily conversation and simple texts.',
  B1: 'intermediate — upper-intermediate vocabulary including academic/professional terms.',
  B2: 'upper-intermediate — advanced vocabulary, idiomatic expressions, nuanced collocations.'
};

/**
 * Prompt system cho việc review MỘT câu hỏi trong pool. Không nhồi prompt sinh câu
 * hỏi — chỉ mô tả cấu trúc loại đó + rubric soi lỗi theo góc nhìn người làm bài,
 * và yêu cầu chỉ sửa đúng chỗ hỏng.
 */
export function buildReviewPrompt(quizType: QuizType, ctx: ReviewContext, opts?: { adminNote?: string }): string {
  const wrongAnswerCount = ctx.optionCount - 1;
  const spec = QUIZ_TYPE_REVIEW_SPEC[quizType]
    .replace(/<optionCount-1>/g, String(wrongAnswerCount))
    .replace(/<optionCount>/g, String(ctx.optionCount));

  const adminNote = opts?.adminNote?.trim();
  const adminNoteBlock = adminNote
    ? `

ADMIN FOCUS NOTE (người duyệt yêu cầu chú ý riêng cho câu này — ưu tiên cao):
"""
${adminNote}
"""
Soi kỹ theo hướng admin nêu, nhưng vẫn tuân thủ EDIT DISCIPLINE. Vẫn trả về đủ revisedData + checklist + issues.`
    : '';

  return `You are a meticulous English-quiz reviewer. You do NOT rewrite good questions — you find concrete defects and fix only those.

LEARNER LEVEL: ${ctx.engLevel} (CEFR) — ${LEVEL_NOTE[ctx.engLevel]}
Judge the item as if TAKEN by a learner at exactly this level. Do NOT demand maximum difficulty: a simple, clean, unambiguous question at this level is CORRECT as-is — do not "upgrade" its distractors.
TOPIC (soft): "${ctx.topicName ?? 'no specific topic'}" — only the central tested item + any context sentence must fit the topic; distractors are exempt.

${spec}

The user message gives you TWO views of the same item: (1) ĐỀ BÀI + CÁC PHƯƠNG ÁN exactly as the learner sees them, (2) the RAW JSON (the object you must return a corrected copy of).

REVIEW CHECKLIST — evaluate the ORIGINAL item on each point:
1. SOLVABLE — Simulate the learner. From the STEM + the option list ALONE, can they reach the correct answer by reasoning? (not blind guessing, not outside knowledge, not information that isn't shown).
2. ENOUGH CONTEXT — Is there a concrete clue in the stem/context that PINS the answer? Especially fillblank / conversation / description / paragraph. If a near-synonym distractor would ALSO fit the stem, context is insufficient.
3. ONE DEFENSIBLE ANSWER — Is the labelled correct answer genuinely correct, AND is every distractor wrong in this context with no reading / register / usage where it could be right? Two defensible options = broken.
4. SPELLING & GRAMMAR — typos or grammar errors in ANY field: stem, options, explanations, examples, translations. List each.
5. EXPLANATION MATCHES ANSWER — does \`explanation\` actually justify THIS correct answer (the right word/statement, not contradicting it, not describing a different option)?
6. DISTRACTOR EXPLANATIONS MATCH — does the per-distractor explanation array line up with the distractor array by INDEX (same length, [i] describes option [i]), citing the stem context rather than a generic "nghĩa khác nhau"?
7. TRANSLATIONS MATCH — where the item has Vietnamese translation fields (sentenceTranslation / optionTranslations / correctAnswerTranslation / translation / highlightedWord): does the Vietnamese match the English, and does highlightedWord actually appear in sentenceTranslation and correspond to the answer?
8. FORMAT — parallel array lengths all == ${wrongAnswerCount}; "___" present where required; no proper nouns; \`explanation\` is 1–2 Vietnamese sentences with no embedded example and no markdown; all string fields JSON-clean.

EDIT DISCIPLINE:
- Change ONLY fields that fail a check. Keep the tested word/phrase/idiom/slang, the topic, the difficulty, and every JSON key. Keep array lengths and index alignment. NEVER swap the tested item for a different one. NEVER rewrite a passing question just to "improve" it.
- If you are unsure something is wrong, do NOT change it — record it as a low-severity issue instead.

VERDICT:
- "pass" — solvable, one clear answer, no errors → return revisedData BYTE-IDENTICAL to the input JSON.
- "revised" — you fixed concrete defects → return revisedData with ONLY those fields changed.
- "reject" — no defensible single answer even after edits, OR the stem is missing essential information, OR the tested item itself is invalid → still return your best-effort fix in revisedData, but set verdict "reject" and explain in summary why it should be discarded instead of approved.
${adminNoteBlock}

Return JSON:
- "revisedData": the FULL item, EXACT same keys / shape / types as the RAW JSON.
- "checklist": booleans (see the fields the schema requires). Each flag = "this problem is present in the ORIGINAL" (true = there is a problem).
- "issues": [{ "field", "severity" (low|medium|high), "problem" (tiếng Việt), "fix" (tiếng Việt) }]. Empty array if none.
- "verdict": "pass" | "revised" | "reject".
- "summary": 1–3 câu tiếng Việt.
- "score": integer 0–100 rating the ORIGINAL item's quality.

Output pure JSON only, no markdown, no commentary.`;
}
