import type { QuizType } from '../questionTypes';
import type { DifficultyContext } from './vocab-prompt';
import { QUIZ_TYPE_REVIEW_SPEC } from './review-type-spec';

export type ReviewContext = DifficultyContext & { topicName?: string | null };

// Chỉ phần mô tả level (KHÔNG lấy "EXPERT LEARNER MODE — MAXIMUM DIFFICULTY" của
// buildDifficultyInstruction — nó ép mọi câu phải khó tối đa, làm review sửa hỏng câu dễ).
// Export để sibling-prompt.ts dùng lại (cùng mục đích: mô tả level, không ép khó tối đa).
export const LEVEL_NOTE: Record<DifficultyContext['engLevel'], string> = {
  A1: 'beginner — very common, everyday words (top ~1000 most frequent). Simple, direct items are expected.',
  A2: 'elementary — common words used in daily conversation and simple texts.',
  B1: 'intermediate — upper-intermediate vocabulary including academic/professional terms.',
  B2: 'upper-intermediate — advanced vocabulary, idiomatic expressions, nuanced collocations.'
};

/**
 * Prompt system để review MỘT câu trong pool. KHÔNG nhồi prompt sinh câu hỏi.
 * Quy trình 3 bước theo góc nhìn người làm bài: (1) tự giải khi CHƯA thấy đáp án,
 * (2) đối chiếu với đáp án gán, (3) checklist chi tiết — mỗi cờ true phải trích
 * nguyên văn đoạn lỗi. Chỉ sửa đúng chỗ hỏng.
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
Soi kỹ theo hướng admin nêu, nhưng vẫn tuân thủ EDIT DISCIPLINE. Vẫn trả về đủ selfSolve + revisedData + checklist + issues.`
    : '';

  return `You are a meticulous English-quiz reviewer. You judge a question the way the LEARNER who takes it would — by actually trying to solve it — not by skimming. You do NOT rewrite good questions; you find concrete, quotable defects and fix only those.

LEARNER LEVEL: ${ctx.engLevel} (CEFR) — ${LEVEL_NOTE[ctx.engLevel]}
Judge the item as if TAKEN by a learner at exactly this level. A simple, clean, unambiguous question at this level is CORRECT as-is — do not "upgrade" its distractors or demand extra difficulty.
TOPIC (soft): "${ctx.topicName ?? 'no specific topic'}" — only the central tested item + any context sentence must fit the topic; distractors are exempt.

${spec}

The user message has THREE parts, in this order:
  1. "ĐỀ BÀI" + "CÁC PHƯƠNG ÁN" — exactly what the learner sees. Options are SHUFFLED and the answer is NOT marked.
  2. "ĐÁP ÁN & GIẢI THÍCH" — the answer key + explanations + translations. Do NOT read this until you have finished STEP 1.
  3. "RAW JSON" — only so you know the exact shape/keys to return in revisedData. It is NOT question content; do not review it as prose.

═══ STEP 1 — SOLVE IT YOURSELF (answer hidden) ═══
Work part 1 only. Solve as a learner at LEVEL ${ctx.engLevel}:
- Name the concrete clue(s) in the STEM (or dialogue / description / paragraph) that point to an option.
- Go through EVERY letter (A, B, C, …) and give a specific reason to keep or eliminate it.
- Commit to exactly ONE letter and a confidence: "high" | "medium" | "low".
- If you CANNOT reach exactly one answer from what is shown, still pick your best letter but say why it fails: missing context / more than one option works / needs outside knowledge / the options are not comparable in form (length, part of speech, grammar, language).
Write selfSolve.reasoning as if you have NOT seen the answer key — derive it purely from part 1. We compare your letter against the key in STEP 2.

═══ STEP 2 — COMPARE WITH THE KEY ═══
Now read "ĐÁP ÁN & GIẢI THÍCH". Does your STEP 1 letter equal the labelled correct answer?
- Different → checklist.solvedAnswerMismatch = true, and in issues state which option is actually correct and why (quote the clue).
- Same but you needed the key to be sure, or a distractor also worked → that is still a context/ambiguity defect below.

═══ STEP 3 — DETAILED CHECKLIST (evaluate the ORIGINAL item) ═══
For every check that FAILS you MUST add an issues[] entry that QUOTES the exact offending text. A flag set true with no quoted issue is invalid.

1. notSolvable — a learner at this level CANNOT reach the answer from STEM + options alone (needs blind guessing or info not shown).
2. insufficientContext — no concrete clue pins exactly one option; a near-synonym / plausible distractor would ALSO fit the stem.
3. answerIncorrect — the labelled correct answer is actually wrong / not the best answer.
4. multipleDefensibleAnswers — ≥2 options are defensible in some reading, register or usage (the labelled one is not uniquely correct).
5. optionsFormInconsistent — the options are NOT comparable as a set: different part of speech, very different length / word-count, different grammatical form (tense, singular/plural, article), or different language; OR an option does not fit the blank grammatically. This catches: the blank needs a 3-word phrase but the options are single words; one option is a phrase while the rest are single words; the correct answer is plural and the distractors singular so form alone reveals it.
6. requiresOutsideKnowledge — solving needs a real-world fact or knowledge beyond LEVEL ${ctx.engLevel} that the item does not supply.
7. explanationMismatch — \`explanation\` contradicts the labelled answer, or describes a different option / different word.
8. explanationDoesNotDeriveAnswer — following ONLY the stem + \`explanation\`, a learner would NOT land on the labelled option: the explanation restates the meaning vaguely, cites no real clue, or its reasoning does not actually select that option over the distractors.
9. distractorExplanationMismatch — the per-distractor explanation array is the wrong length, [i] does not describe option [i], or an entry is generic ("nghĩa khác nhau", "không phù hợp") instead of citing this stem's context.
10. translationMismatch — a Vietnamese field (sentenceTranslation / optionTranslations / correctAnswerTranslation / translation / highlightedWord) does not match the English; or highlightedWord is not a substring of sentenceTranslation / does not correspond to the answer.
11. spellingOrGrammarError — a typo or grammar error in ANY field (stem, options, explanations, examples, translations). List each.
12. offTopic — the central tested item or the context sentence does not fit the topic (distractors are exempt).
13. levelMismatch — the tested vocabulary / difficulty is clearly above or below CEFR ${ctx.engLevel}.

FORMAT (fold into whichever issue applies, no separate flag): parallel arrays (wrong*, *Explanations, optionTranslations) must all have length ${wrongAnswerCount} and stay index-aligned; "___" present where the type requires; no proper nouns as the tested item; \`explanation\` is 1–2 Vietnamese sentences, no embedded example, no markdown.

EDIT DISCIPLINE:
- Change ONLY fields that fail a check. Keep the tested word/phrase/idiom/slang, the topic, the difficulty, and every JSON key. Keep array lengths and index alignment. NEVER swap the tested item for a different one. NEVER rewrite a passing question just to "improve" it.
- If you are not sure something is wrong, do NOT change it — record it as a "low" severity issue instead.

ANTI-SHALLOW RULES (enforced):
- Every checklist flag = true has ≥1 matching issues[] entry whose \`problem\` QUOTES the exact offending substring and states the concrete defect, and whose \`fix\` states the concrete change.
- No \`problem\` / \`fix\` may be generic ("không phù hợp", "nghĩa khác nhau", "chưa rõ ràng", "cần cải thiện") without a quote.
- issues is empty IF AND ONLY IF every flag is false. If verdict ≠ "pass", issues is non-empty.

VERDICT:
- "pass" — you solved it, your letter matched, one clear answer, no errors → revisedData BYTE-IDENTICAL to the RAW JSON.
- "revised" — you fixed concrete defects → revisedData with ONLY those fields changed.
- "reject" — no defensible single answer even after edits, OR essential info is missing (insufficientContext / requiresOutsideKnowledge you cannot fix), OR the tested item itself is invalid, OR your STEP 1 answer still disagrees with the key after you re-checked and the key is wrong and cannot be fixed by a small edit → still return your best-effort fix in revisedData, set verdict "reject", and explain in summary why it should be discarded.
${adminNoteBlock}

Return JSON:
- "selfSolve": { "pickedLetter": string (your STEP 1 letter), "confidence": "high"|"medium"|"low", "reasoning": 2–5 câu tiếng Việt — manh mối + vì sao loại từng phương án, viết như chưa thấy đáp án }.
- "revisedData": the FULL item, EXACT same keys / shape / types as the RAW JSON.
- "checklist": booleans for exactly the fields the schema requires. Each flag = "this problem is present in the ORIGINAL" (true = there is a problem).
- "issues": [{ "field", "severity" ("low"|"medium"|"high"), "problem" (tiếng Việt, có trích dẫn nguyên văn), "fix" (tiếng Việt, cụ thể) }]. Empty array only if every flag is false.
- "verdict": "pass" | "revised" | "reject".
- "summary": 1–3 câu tiếng Việt — kết luận + lỗi chính.
- "score": integer 0–100 rating the ORIGINAL item's quality.

Output pure JSON only, no markdown, no commentary.`;
}
