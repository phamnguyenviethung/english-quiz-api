import type { QuizType } from '../questionTypes';

/**
 * Mô tả cấu trúc JSON + "người học nhìn thấy gì" cho từng loại quiz trong pool.
 * Dùng cho review prompt — KHÔNG phải prompt sinh câu hỏi. Mọi mảng song song
 * (`wrong*`, `*Explanations`, `optionTranslations`) dài đúng `optionCount - 1` và
 * cùng thứ tự; option người học thấy = [đáp án đúng, ...distractors] rồi client trộn.
 */
export const QUIZ_TYPE_REVIEW_SPEC: Record<QuizType, string> = {
  vocab: `STRUCTURE ("vocab") — test the Vietnamese meaning of an English word.
- Learner sees — STEM: the word \`word\` (client shows: "\\"<word>\\" có nghĩa là gì?"). OPTIONS: <optionCount> Vietnamese meanings = [\`correctAnswer\`, ...\`wrongAnswers\`] (client shuffles, letters A–F).
- \`correctAnswer\` = the correct answer — a concise VIETNAMESE gloss of \`word\`.
- \`wrongAnswers\` = distractors — VIETNAMESE meanings, same part of speech, each fully wrong in every sense/register. Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order as \`wrongAnswers\`; item [i] must explain why \`wrongAnswers\`[i] is wrong.
- \`explanation\` = 1–2 Vietnamese sentences: the real meaning/nuance/register of \`word\`. No example, no markdown.
- \`exampleSentence\` / \`exampleTranslation\` = a fresh English sentence using \`word\` + its Vietnamese translation (study aid, not part of the question).
- Metadata (NOT an option): \`partOfSpeech\`.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`; \`word\` and options are not proper nouns.`,

  fillblank: `STRUCTURE ("fillblank") — choose the English word that fills a blank in a sentence.
- Learner sees — STEM: \`sentence\` (contains literal "___"), with \`sentenceTranslation\` shown under it and \`highlightedWord\` highlighted. OPTIONS: <optionCount> ENGLISH words = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled), each may show its Vietnamese gloss.
- \`correctAnswer\` = the correct answer — the ENGLISH word that fills "___", in the exact inflected form the sentence needs.
- \`wrongAnswers\` = distractors — ENGLISH words, same part of speech, grammatically valid in the slot, wrong SPECIFICALLY because of this sentence's context. Exactly <optionCount-1> items.
- \`optionTranslations\` = Vietnamese gloss of each \`wrongAnswers\` item, SAME order. \`correctAnswerTranslation\` = Vietnamese gloss of \`correctAnswer\`.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] must cite the specific clue in THIS sentence that rules out \`wrongAnswers\`[i].
- \`sentenceTranslation\` = full Vietnamese translation of \`sentence\` with the blank filled in (no "___"). \`highlightedWord\` = the exact Vietnamese substring of \`sentenceTranslation\` corresponding to the answer.
- \`explanation\` = 1–2 Vietnamese sentences: why the correct word fits THIS sentence (cite the clue). \`exampleSentence\`/\`exampleTranslation\` = a different English sentence + translation.
- Metadata (NOT an option): \`word\`.
- Invariants: \`sentence\` contains "___"; \`wrongAnswers.length === optionTranslations.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  phrase: `STRUCTURE ("phrase") — test the Vietnamese meaning of an English phrase / collocation / phrasal verb.
- Learner sees — STEM: \`phrase\` (client shows: "Cụm từ \\"<phrase>\\" có nghĩa là gì?"). May contain placeholders sth/sb. OPTIONS: <optionCount> Vietnamese meanings = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`correctAnswer\` = the correct answer — VIETNAMESE idiomatic meaning of the WHOLE phrase (placeholders as "điều gì đó"/"ai đó").
- \`wrongAnswers\` = distractors — VIETNAMESE meanings that belong to COMPLETELY DIFFERENT phrases (no partial/paraphrase overlap with the correct meaning). Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] states what the phrase really means and why \`wrongAnswers\`[i] is fundamentally different.
- \`explanation\` = 1–2 Vietnamese sentences: real meaning + usage context/register. No example, no markdown.
- \`exampleSentence\`/\`exampleTranslation\` = English sentence using the phrase (placeholders replaced by real words) + translation.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  conversation: `STRUCTURE ("conversation") — choose the English word/phrase that fills a blank inside a 4-line dialogue.
- Learner sees — STEM: the 4 lines of \`dialogueLines\` (one contains "___"), then \`sentence\` (= dialogueLines joined by newlines, one "___") with \`sentenceTranslation\` and \`highlightedWord\` highlighted. OPTIONS: <optionCount> ENGLISH words/phrases = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`correctAnswer\` = the correct answer — the ENGLISH word/short phrase that fills "___".
- \`wrongAnswers\` = distractors — ENGLISH words/phrases, same part of speech / collocation pattern, valid grammar in the blank, wrong due to THIS dialogue's context. Exactly <optionCount-1> items.
- \`optionTranslations\` = Vietnamese gloss of each \`wrongAnswers\` item, SAME order. \`correctAnswerTranslation\` = Vietnamese gloss of \`correctAnswer\`.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] cites the dialogue clue that rules out \`wrongAnswers\`[i].
- \`sentenceTranslation\` = full Vietnamese translation of the dialogue, blank filled. \`explanation\` = 1–2 Vietnamese sentences: why the answer fits the conversation. \`exampleSentence\`/\`exampleTranslation\` = a different sentence + translation.
- Metadata (NOT an option): \`highlightedWord\`.
- Invariants: \`dialogueLines.length === 4\`; exactly one line and \`sentence\` contain "___"; \`wrongAnswers.length === optionTranslations.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  description: `STRUCTURE ("description") — from a real-life scene/use-case clue, pick the matching English word.
- Learner sees — STEM: \`description\` (a scenario, in Vietnamese or English per \`descriptionLanguage\`), then "Từ tiếng Anh nào phù hợp nhất với tình huống này?". OPTIONS: <optionCount> ENGLISH words = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`correctAnswer\` = the correct answer — a SINGLE English word (noun/verb/adjective per \`partOfSpeech\`), uniquely matching the clue.
- \`wrongAnswers\` = distractors — ENGLISH words, same part of speech, definitively wrong for THIS clue (not synonyms / broader / narrower). Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] quotes/paraphrases the clue that rules out \`wrongAnswers\`[i].
- \`explanation\` = 1–2 Vietnamese sentences: why \`correctAnswer\` fits the clue. \`exampleSentence\`/\`exampleTranslation\` = English sentence using \`correctAnswer\` + translation.
- Metadata (NOT an option): \`descriptionLanguage\`, \`partOfSpeech\`.
- Invariants: \`correctAnswer\` is one token; \`description\` must NOT contain \`correctAnswer\` (or an inflected form or a Vietnamese translation of it) and must NOT read like a dictionary definition or a meta-question ("nghĩa là", "which word", "chọn từ"...); \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`; \`descriptionLanguage\` must truthfully label the language of \`description\`.`,

  synonym: `STRUCTURE ("synonym") — pick the English word that is a synonym OR antonym of a given word.
- Learner sees — STEM: \`word\` plus the task from \`questionType\` (client shows: "Từ nào là {đồng nghĩa|trái nghĩa} của \\"<word>\\"?"). OPTIONS: <optionCount> ENGLISH words = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`questionType\` = "synonym" | "antonym" — tells the learner which relation to pick. This is the TASK, not an option.
- \`correctAnswer\` = the correct answer — a single ENGLISH word that truly is the \`questionType\` (synonym/antonym) of \`word\`.
- \`wrongAnswers\` = distractors — ENGLISH words, same part of speech as \`correctAnswer\`, NOT a \`questionType\` of \`word\` in any context. Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] gives \`wrongAnswers\`[i]'s meaning and why it is not the required relation to \`word\`.
- \`explanation\` = 1–2 Vietnamese sentences: meaning of \`word\` + why \`correctAnswer\` is the true synonym/antonym. \`exampleSentence\`/\`exampleTranslation\` = English sentence using the ORIGINAL \`word\` (not \`correctAnswer\`) + translation.
- Metadata (NOT an option): \`partOfSpeech\`.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  slang: `STRUCTURE ("slang") — test the Vietnamese meaning of an English slang term.
- Learner sees — STEM: \`slang\` (client shows: "Slang \\"<slang>\\" có nghĩa là gì?"). OPTIONS: <optionCount> Vietnamese meanings = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`correctAnswer\` = the correct answer — VIETNAMESE meaning reflecting real contemporary usage.
- \`wrongAnswers\` = distractors — VIETNAMESE meanings that sound like plausible slang meanings but are entirely wrong (no overlap/paraphrase). Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] contrasts \`wrongAnswers\`[i] with the real meaning of \`slang\`.
- \`explanation\` = 1–2 casual Vietnamese sentences: real meaning + who/where it's used. \`exampleSentence\`/\`exampleTranslation\` = authentic texting/social-media English sentence + translation.
- Metadata (NOT an option): \`partOfSpeech\`.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  'odd-one-out': `STRUCTURE ("odd-one-out") — pick the ONE word that does not belong with the others. (This type inverts the usual layout.)
- Learner sees — STEM: the task "Từ nào KHÔNG thuộc nhóm với các từ còn lại?". OPTIONS: <optionCount> ENGLISH words = \`groupWords\` ∪ {\`oddWord\`} (shuffled).
- \`oddWord\` = the CORRECT ANSWER — a single ENGLISH word from a COMPLETELY different domain than the group (zero overlap). It is NOT in \`groupWords\`.
- \`groupWords\` = the distractors — ENGLISH words that all clearly belong together (share the group's category). Exactly <optionCount-1> items.
- \`groupWordExplanations\` = one Vietnamese sentence per \`groupWords\` item, SAME count & order; [i] gives \`groupWords\`[i]'s meaning + what it is/does. (There is NO per-option explanation array for \`oddWord\`.)
- \`groupTheme\` = short English label of what the group shares — INTERNAL, must NOT be repeated inside \`explanation\`/\`groupWordExplanations\`.
- \`explanation\` = EXACTLY 2 Vietnamese sentences: (1) what the group words have in common by function; (2) \`oddWord\`'s meaning and why it has nothing to do with the group.
- \`exampleSentence\`/\`exampleTranslation\` = English sentence using \`oddWord\` + translation.
- Invariants: \`groupWords.length === groupWordExplanations.length === optionCount - 1\`; \`oddWord\` is not equal to and does not prefix-overlap any \`groupWords\` item (case-insensitive); on-screen options = <optionCount>.`,

  paragraph: `STRUCTURE ("paragraph") — read a short English paragraph and choose the statement that is TRUE about it.
- Learner sees — CONTEXT: \`paragraph\` (4–7 English sentences) with \`translation\` (full Vietnamese) shown. STEM: "Nhận định nào dưới đây ĐÚNG với đoạn văn?". OPTIONS: <optionCount> ENGLISH statements = [\`correctStatement\`, ...\`wrongStatements\`] (shuffled).
- \`correctStatement\` = the correct answer — a full ENGLISH statement directly verifiable from one explicit sentence of \`paragraph\`, reworded (not copied), unambiguously true.
- \`wrongStatements\` = distractors — full ENGLISH statements, each 100% FALSE vs the paragraph, similar in length/style to \`correctStatement\`. Exactly <optionCount-1> items.
- \`wrongStatementExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] names the specific paragraph fact/sentence that contradicts \`wrongStatements\`[i].
- \`explanation\` = 1–2 Vietnamese sentences: why \`correctStatement\` is true + cite the confirming sentence.
- \`translation\` = full Vietnamese translation of \`paragraph\` (single string, no literal newlines).
- No \`exampleSentence\`. Invariants: \`wrongStatements.length === wrongStatementExplanations.length === optionCount - 1\`; \`paragraph\` contains no text that looks like an answer option.`,

  idiom: `STRUCTURE ("idiom") — test the Vietnamese figurative meaning of an English idiom.
- Learner sees — STEM: \`idiom\` (client shows: "Idiom \\"<idiom>\\" có nghĩa là gì?"). OPTIONS: <optionCount> Vietnamese meanings = [\`correctAnswer\`, ...\`wrongAnswers\`] (shuffled).
- \`correctAnswer\` = the correct answer — VIETNAMESE FIGURATIVE meaning of the WHOLE idiom (not word-by-word).
- \`wrongAnswers\` = distractors — VIETNAMESE meanings belonging to COMPLETELY DIFFERENT idioms/expressions (no partial/paraphrase overlap). Exactly <optionCount-1> items.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] contrasts \`wrongAnswers\`[i] with the real meaning of the idiom.
- \`explanation\` = 1–2 casual Vietnamese sentences: real idiomatic meaning + usage context. \`exampleSentence\`/\`exampleTranslation\` = authentic English sentence containing the idiom verbatim + translation.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`.`,

  'verb-use-match': `STRUCTURE ("verb-use-match") — pick the natural verb+noun collocation. Behaviour depends on \`format\`.
- \`format\` = "fill-blank": STEM = \`sentence\` (contains "___" where only the VERB is removed); OPTIONS = <optionCount> ENGLISH verbs = [\`verb\`, ...\`wrongAnswers\`] (shuffled); \`wrongAnswers\` are wrong VERBS.
- \`format\` = "phrase-choice": STEM = \`sentence\` (a question like "Which phrase sounds most natural?", NO "___"); OPTIONS = <optionCount> ENGLISH phrases = [\`targetPhrase\`, ...\`wrongAnswers\`] (shuffled); \`wrongAnswers\` are wrong FULL phrases (wrong verb + same noun).
- \`targetPhrase\` = the correct collocation as a full phrase (e.g. "make a decision"). \`verb\` = verb part only; \`noun\` = noun/object part only. There is no \`correctAnswer\` field.
- \`wrongAnswerExplanations\` = one Vietnamese sentence per distractor, SAME count & order; [i] says what \`wrongAnswers\`[i] normally collocates with and why \`targetPhrase\` is the natural choice.
- \`explanation\` = 1–2 casual Vietnamese sentences about why this verb+noun sounds natural. \`exampleSentence\`/\`exampleTranslation\` = authentic English sentence using \`targetPhrase\` verbatim + translation.
- Metadata (NOT an option): \`format\`, \`verb\`, \`noun\`.
- Invariants: \`wrongAnswers.length === wrongAnswerExplanations.length === optionCount - 1\`; \`format="fill-blank"\` ⇒ \`sentence\` contains "___"; \`format="phrase-choice"\` ⇒ \`sentence\` has no "___"; \`verb\` + " " + \`noun\` should equal \`targetPhrase\` (modulo spacing/articles).`
};

// ─── Learner-view renderer ───────────────────────────────────────────────────

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString) : [];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function renderOptions(correct: string, wrongs: string[]): string {
  const all = [correct, ...wrongs].filter((s) => s.length > 0);
  const lines = all.map((opt, i) => `${LETTERS[i] ?? String(i + 1)}. ${opt}`);
  return `${lines.join('\n')}\nĐÁP ÁN ĐÚNG: A  (${correct})`;
}

/**
 * Dựng lại "màn hình người làm bài" từ questionData đã parse, để review model
 * nhìn câu hỏi bằng mắt người học thay vì đọc JSON thô. Defensive — field thiếu
 * thì bỏ qua, không throw.
 */
export function renderLearnerView(quizType: QuizType, data: Record<string, unknown>): string {
  const d = data ?? {};
  const stemHead = '=== ĐỀ BÀI (người học đọc) ===';
  const optHead = '=== CÁC PHƯƠNG ÁN (đã trộn — người học KHÔNG biết đâu là đáp án đúng) ===';

  switch (quizType) {
    case 'vocab':
    case 'phrase':
    case 'slang':
    case 'idiom': {
      const key = quizType === 'vocab' ? 'word' : quizType === 'phrase' ? 'phrase' : quizType;
      const stemWord = asString(d[key]);
      const label =
        quizType === 'vocab'
          ? `"${stemWord}" có nghĩa là gì?`
          : quizType === 'phrase'
            ? `Cụm từ "${stemWord}" có nghĩa là gì?`
            : quizType === 'slang'
              ? `Slang "${stemWord}" có nghĩa là gì?`
              : `Idiom "${stemWord}" có nghĩa là gì?`;
      return `${stemHead}\nSTEM: ${label}\n\n${optHead}\n${renderOptions(asString(d.correctAnswer), asStringArray(d.wrongAnswers))}`;
    }

    case 'fillblank': {
      const sentence = asString(d.sentence);
      const tr = asString(d.sentenceTranslation);
      return `${stemHead}\nSTEM (điền vào ___): ${sentence}\nBản dịch: ${tr}\nTừ được nhấn: ${asString(d.highlightedWord)}\n\n${optHead}\n${renderOptions(asString(d.correctAnswer), asStringArray(d.wrongAnswers))}`;
    }

    case 'conversation': {
      const lines = asStringArray(d.dialogueLines).join('\n');
      const tr = asString(d.sentenceTranslation);
      return `${stemHead}\nHỘI THOẠI (điền vào ___):\n${lines}\nBản dịch: ${tr}\nTừ được nhấn: ${asString(d.highlightedWord)}\n\n${optHead}\n${renderOptions(asString(d.correctAnswer), asStringArray(d.wrongAnswers))}`;
    }

    case 'description': {
      const desc = asString(d.description);
      return `${stemHead}\nMÔ TẢ (ngôn ngữ: ${asString(d.descriptionLanguage) || '?'}): ${desc}\nSTEM: Từ tiếng Anh nào phù hợp nhất với tình huống này?\nLoại từ cần chọn: ${asString(d.partOfSpeech)}\n\n${optHead}\n${renderOptions(asString(d.correctAnswer), asStringArray(d.wrongAnswers))}`;
    }

    case 'synonym': {
      const rel = asString(d.questionType) === 'antonym' ? 'trái nghĩa' : 'đồng nghĩa';
      return `${stemHead}\nSTEM: Từ nào là ${rel} của "${asString(d.word)}"?\nLoại từ: ${asString(d.partOfSpeech)}\n\n${optHead}\n${renderOptions(asString(d.correctAnswer), asStringArray(d.wrongAnswers))}`;
    }

    case 'odd-one-out': {
      return `${stemHead}\nSTEM: Từ nào KHÔNG thuộc nhóm với các từ còn lại?\n(nhóm chung — chỉ để tham khảo, người học không thấy: ${asString(d.groupTheme)})\n\n${optHead}\n${renderOptions(asString(d.oddWord), asStringArray(d.groupWords))}`;
    }

    case 'paragraph': {
      return `${stemHead}\nĐOẠN VĂN: ${asString(d.paragraph)}\nBản dịch: ${asString(d.translation)}\nSTEM: Nhận định nào dưới đây ĐÚNG với đoạn văn?\n\n${optHead}\n${renderOptions(asString(d.correctStatement), asStringArray(d.wrongStatements))}`;
    }

    case 'verb-use-match': {
      const isFillBlank = asString(d.format) === 'fill-blank';
      const correct = isFillBlank
        ? asString(d.verb)
        : asString(d.targetPhrase) || `${asString(d.verb)} ${asString(d.noun)}`.trim();
      const stem = isFillBlank
        ? `STEM (điền động từ vào ___): ${asString(d.sentence)}`
        : `STEM: ${asString(d.sentence) || 'Phrase nào tự nhiên nhất?'}`;
      return `${stemHead}\nDạng: ${asString(d.format)} · collocation đúng: ${asString(d.targetPhrase)}\n${stem}\n\n${optHead}\n${renderOptions(correct, asStringArray(d.wrongAnswers))}`;
    }

    default:
      return `${stemHead}\n(không dựng được learner view cho quizType "${quizType}")`;
  }
}
