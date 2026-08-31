import type { SiblingQuizType } from '../questionTypes';
import type { DifficultyContext } from './vocab-prompt';
import { LEVEL_NOTE } from './review-prompt';

export type SiblingContext = DifficultyContext & { topicName?: string | null };

/**
 * Với mỗi loại quiz hỗ trợ sinh câu tương tự (sibling): những key JSON PHẢI giữ
 * **byte-identical** so với câu gốc — đây là "phần cần học" (từ/cụm/idiom/slang…) cùng
 * các thuộc tính gắn liền (loại từ, quan hệ, format). Service khôi phục cưỡng bức các key
 * này nếu model lỡ đổi. Các key còn lại BẮT BUỘC sinh mới và khác rõ rệt so với câu gốc.
 */
export const SIBLING_LOCK_FIELDS_BY_TYPE: Record<SiblingQuizType, string[]> = {
  vocab: ['word', 'partOfSpeech'],
  phrase: ['phrase'],
  idiom: ['idiom'],
  slang: ['slang', 'partOfSpeech'],
  synonym: ['word', 'questionType', 'partOfSpeech'],
  fillblank: ['word'],
  conversation: ['correctAnswer'],
  description: ['correctAnswer', 'partOfSpeech', 'descriptionLanguage'],
  'verb-use-match': ['format', 'targetPhrase', 'verb', 'noun']
};

/**
 * Mô tả ngắn (văn xuôi) cho model khi sinh sibling từng loại: phần nào KHÓA, phần nào
 * PHẢI đổi mới. `<optionCount>` / `<optionCount-1>` được thay số thật trong buildSiblingPrompt.
 */
export const QUIZ_TYPE_SIBLING_SPEC: Record<SiblingQuizType, string> = {
  vocab: `LOẠI "vocab": người học thấy một từ tiếng Anh và chọn nghĩa tiếng Việt đúng trong <optionCount> lựa chọn. KHÓA: "word" + "partOfSpeech" giữ y hệt. "correctAnswer" phải giữ NGHĨA tương đương câu gốc (có thể diễn đạt lại gọn hơn, KHÔNG đổi sang nghĩa khác). ĐỔI MỚI: <optionCount-1> "wrongAnswers" (bộ distractor mới, cùng loại từ, sai ở mọi nghĩa), "wrongAnswerExplanations" tương ứng theo thứ tự, "explanation", "exampleSentence" + "exampleTranslation" (tình huống đời thường MỚI, khác hẳn câu gốc).`,

  phrase: `LOẠI "phrase": người học thấy một cụm từ / phrasal verb / collocation và chọn nghĩa tiếng Việt đúng. KHÓA: "phrase" giữ y hệt. "correctAnswer" giữ nghĩa thành ngữ tương đương. ĐỔI MỚI: bộ "wrongAnswers" (<optionCount-1> nghĩa của cụm HOÀN TOÀN khác, không diễn giải lại nghĩa đúng), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  idiom: `LOẠI "idiom": người học thấy một thành ngữ và chọn nghĩa BÓNG tiếng Việt đúng. KHÓA: "idiom" giữ y hệt. "correctAnswer" giữ nghĩa bóng tương đương. ĐỔI MỚI: bộ "wrongAnswers" (<optionCount-1> nghĩa của thành ngữ khác hẳn), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  slang: `LOẠI "slang": người học thấy một từ lóng và chọn nghĩa tiếng Việt đúng theo cách dùng hiện đại. KHÓA: "slang" + "partOfSpeech" giữ y hệt. "correctAnswer" giữ nghĩa lóng tương đương. ĐỔI MỚI: bộ "wrongAnswers" (<optionCount-1> nghĩa nghe hợp lý nhưng sai hẳn), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  synonym: `LOẠI "synonym": người học thấy một từ + yêu cầu tìm đồng nghĩa HOẶC trái nghĩa (theo "questionType") trong <optionCount> lựa chọn. KHÓA: "word" + "questionType" + "partOfSpeech" giữ y hệt. ĐỔI MỚI: "correctAnswer" CÓ THỂ chọn một từ đồng/trái nghĩa hợp lệ KHÁC (tăng đa dạng) miễn đúng quan hệ và loại từ; bộ "wrongAnswers" (<optionCount-1> từ cùng loại từ nhưng KHÔNG phải quan hệ đó ở bất kỳ nghĩa nào), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  fillblank: `LOẠI "fillblank": người học thấy một câu tiếng Anh có "___" và chọn từ điền vào trong <optionCount> lựa chọn. KHÓA: "word" (từ cần học) giữ y hệt. "correctAnswer" là chính từ đó, có thể chia dạng (thì / số ít-nhiều) cho khớp câu MỚI. ĐỔI MỚI BẮT BUỘC: "sentence" (câu hoàn toàn khác — bối cảnh khác, cấu trúc khác — vẫn đủ ngữ cảnh để CHỈ một từ điền được), "sentenceTranslation", "highlightedWord", "correctAnswerTranslation", bộ "wrongAnswers" (<optionCount-1> từ cùng loại từ, cùng dạng, đúng ngữ pháp ở chỗ trống nhưng sai vì ngữ cảnh MỚI), "optionTranslations", "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  conversation: `LOẠI "conversation": người học thấy hội thoại 4 dòng, một dòng có "___", và chọn từ/cụm ngắn điền vào. KHÓA: "correctAnswer" (từ/cụm cần học) giữ y hệt. ĐỔI MỚI BẮT BUỘC: "dialogueLines" (4 dòng hội thoại MỚI — người nói, tình huống, mạch thoại khác hẳn câu gốc), "sentence" (dòng có "___", khớp hội thoại mới), "sentenceTranslation", "highlightedWord", "correctAnswerTranslation", bộ "wrongAnswers" (<optionCount-1> lựa chọn đúng ngữ pháp ở chỗ trống nhưng sai vì bối cảnh hội thoại mới), "optionTranslations", "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  description: `LOẠI "description": người học đọc một tình huống đời thực (ngôn ngữ theo "descriptionLanguage") rồi chọn MỘT từ tiếng Anh (đúng "partOfSpeech") khớp tình huống. KHÓA: "correctAnswer" (từ cần học) + "partOfSpeech" + "descriptionLanguage" giữ y hệt. ĐỔI MỚI BẮT BUỘC: "description" (tình huống MỚI hoàn toàn — trỏ duy nhất tới đáp án, KHÔNG chứa/không dịch lộ đáp án, không viết như định nghĩa từ điển), bộ "wrongAnswers" (<optionCount-1> từ cùng loại từ, chắc chắn sai với tình huống mới — không phải đồng nghĩa / rộng hơn / hẹp hơn), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`,

  'verb-use-match': `LOẠI "verb-use-match": chọn collocation động từ + danh từ tự nhiên. KHÓA: "format" + "targetPhrase" + "verb" + "noun" giữ y hệt. Nếu format = "fill-blank": "sentence" MỚI có "___" ở chỗ ĐỘNG TỪ. Nếu format = "phrase-choice": "sentence" MỚI không có "___". ĐỔI MỚI BẮT BUỘC: "sentence" (bối cảnh khác hẳn, chỉ một collocation nghe tự nhiên), bộ "wrongAnswers" (<optionCount-1> lựa chọn — với "fill-blank" là các động từ collocate với danh từ khác; với "phrase-choice" là cụm đầy đủ sai động từ + cùng danh từ), "wrongAnswerExplanations", "explanation", "exampleSentence" + "exampleTranslation".`
};

function renderLockedValues(fields: string[], locked: Record<string, unknown>): string {
  return fields.map((f) => `  - "${f}": ${JSON.stringify(locked[f] ?? null)}`).join('\n');
}

/**
 * Prompt system để sinh N "câu tương tự" (sibling) từ MỘT câu pool gốc. Giữ chính xác term
 * cần học + độ khó (CEFR) + topic; ngữ cảnh / distractor / ví dụ / giải thích phải MỚI và
 * khác rõ rệt so với câu gốc. Câu gốc được đưa vào user message ở dạng learner view + answer
 * key (dùng lại buildLearnerView/buildAnswerKey), kèm RAW JSON chỉ để biết shape trả về.
 */
export function buildSiblingPrompt(
  quizType: SiblingQuizType,
  ctx: SiblingContext,
  opts: { lockedValues: Record<string, unknown>; count: number; adminNote?: string }
): string {
  const wrongAnswerCount = ctx.optionCount - 1;
  const spec = QUIZ_TYPE_SIBLING_SPEC[quizType]
    .replace(/<optionCount-1>/g, String(wrongAnswerCount))
    .replace(/<optionCount>/g, String(ctx.optionCount));
  const lockFields = SIBLING_LOCK_FIELDS_BY_TYPE[quizType];
  const lockedBlock = renderLockedValues(lockFields, opts.lockedValues);

  const batchBlock =
    opts.count > 1
      ? `

BATCH — TẠO ĐÚNG ${opts.count} SIBLING:
- Trả về { "questions": [ ${opts.count} object ] }, mỗi object là một câu hoàn chỉnh đúng schema loại "${quizType}".
- ${opts.count} sibling phải khác NHAU và khác câu gốc: khác cấu trúc câu / bối cảnh / bộ distractor / ví dụ. Không copy pattern giữa các câu.`
      : `

OUTPUT: một object JSON đúng schema loại "${quizType}" (một câu), các key y hệt RAW JSON.`;

  const adminNote = opts.adminNote?.trim();
  const adminNoteBlock = adminNote
    ? `

ADMIN FOCUS NOTE (người tạo yêu cầu chú ý riêng — ưu tiên cao):
"""
${adminNote}
"""
Bám hướng admin nêu nhưng vẫn tuân thủ mọi ràng buộc KHÓA / ĐỔI MỚI ở trên.`
    : '';

  return `You generate ALTERNATE VERSIONS ("siblings") of an existing English quiz question. Each sibling tests the EXACT SAME target item, at the SAME CEFR level and the SAME topic, but with a fresh context, fresh distractors, fresh example and fresh explanation. You are NOT reviewing or fixing the source — you are re-dressing it.

LEARNER LEVEL: ${ctx.engLevel} (CEFR) — ${LEVEL_NOTE[ctx.engLevel]}
Keep the difficulty of every sibling at exactly this level — do not make it harder or easier than the source. A clean, simple item at this level is correct as-is.
TOPIC (hard lock): "${ctx.topicName ?? 'no specific topic'}" — the central tested item and any context sentence must fit this topic. Distractors are exempt.

${spec}

HARD LOCKS — reproduce these keys BYTE-IDENTICAL to the source in every sibling (do not fix spelling, casing or inflection):
${lockedBlock}

MUST REGENERATE — materially different from the source shown in the user message:
- The context (sentence / dialogue / description / scenario): a genuinely new situation and wording. Never reuse the source sentence or scenario.
- The distractor set and EVERY per-distractor explanation: written for the NEW context, not copied.
- "exampleSentence" / "exampleTranslation": a new everyday situation, different structure from the source.
- All Vietnamese translation fields must match the new English content.

QUALITY CONTRACT (same as normal generation — see generate-question-common-rule.md §5–§6):
- The context must narrow to EXACTLY ONE defensible answer; a near-synonym distractor must NOT also fit.
- Each wrong answer is unambiguously wrong IN THIS NEW CONTEXT; its explanation cites a concrete clue from the new context (no generic "nghĩa khác nhau").
- Parallel arrays (wrongAnswers, wrongAnswerExplanations, optionTranslations where the type has it) all have length ${wrongAnswerCount} and stay index-aligned.
- "___" is present where the type requires it.
- "explanation": 1–2 Vietnamese sentences, no example inside, no markdown.
- No proper nouns as the tested item or as options.
- Output pure JSON only — no markdown, no commentary.${batchBlock}${adminNoteBlock}`;
}
