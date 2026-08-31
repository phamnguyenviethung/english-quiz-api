import type { QuizType } from '../questionTypes';

/**
 * Mô tả NGẮN GỌN (văn xuôi) cho người review từng loại quiz trong pool: loại này
 * bắt người học làm gì, một câu đạt trông ra sao, và invariant tối thiểu. KHÔNG
 * liệt kê field/kiểu JSON — nội dung câu hỏi được đưa vào prompt ở dạng người đọc
 * (learner view + answer key), raw JSON chỉ kèm để biết shape trả về.
 * `<optionCount>` / `<optionCount-1>` được thay số thật trong buildReviewPrompt.
 */
export const QUIZ_TYPE_REVIEW_SPEC: Record<QuizType, string> = {
  vocab: `LOẠI "vocab": người học thấy một từ tiếng Anh và chọn nghĩa tiếng Việt đúng trong <optionCount> lựa chọn. Câu đạt: từ có một nghĩa phổ biến rõ ràng, đáp án là gloss tiếng Việt gọn đúng nghĩa đó, <optionCount-1> distractor cùng loại từ nhưng sai ở mọi nghĩa/ngữ vực. Mỗi distractor có đúng một câu giải thích tương ứng theo thứ tự.`,

  fillblank: `LOẠI "fillblank": người học thấy một câu tiếng Anh có "___" và chọn từ tiếng Anh điền vào trong <optionCount> lựa chọn. Câu đạt: ngữ cảnh trong câu đủ mạnh để chỉ MỘT từ điền được hợp lý; mọi lựa chọn đều đúng ngữ pháp ở chỗ trống và cùng loại từ, cùng dạng (thì/số ít-nhiều), <optionCount-1> distractor sai vì ngữ cảnh cụ thể này chứ không phải sai ngữ pháp. Có bản dịch câu, gloss cho đáp án và từng distractor.`,

  phrase: `LOẠI "phrase": người học thấy một cụm từ / phrasal verb / collocation tiếng Anh và chọn nghĩa tiếng Việt đúng. Câu đạt: đáp án là nghĩa thành ngữ của CẢ cụm, <optionCount-1> distractor là nghĩa của cụm HOÀN TOÀN khác (không trùng/không diễn giải lại nghĩa đúng). Mỗi distractor có một câu giải thích tương ứng.`,

  conversation: `LOẠI "conversation": người học thấy hội thoại 4 dòng, một dòng có "___", và chọn từ/cụm ngắn tiếng Anh điền vào. Câu đạt: mạch hội thoại chốt được đúng một lựa chọn; mọi lựa chọn đúng ngữ pháp ở chỗ trống, <optionCount-1> distractor sai vì bối cảnh hội thoại. Có bản dịch, gloss đáp án và distractor.`,

  description: `LOẠI "description": người học đọc một tình huống đời thực (tiếng Việt hoặc Anh theo descriptionLanguage) rồi chọn MỘT từ tiếng Anh (đúng loại từ partOfSpeech) khớp tình huống. Câu đạt: tình huống trỏ duy nhất tới đáp án, không chứa/không dịch lộ đáp án, không viết như định nghĩa từ điển; <optionCount-1> distractor cùng loại từ nhưng chắc chắn sai với tình huống này (không phải đồng nghĩa / rộng hơn / hẹp hơn).`,

  synonym: `LOẠI "synonym": người học thấy một từ + yêu cầu tìm đồng nghĩa HOẶC trái nghĩa (theo questionType) trong <optionCount> lựa chọn. Câu đạt: đáp án đúng thật sự là quan hệ được yêu cầu; <optionCount-1> distractor cùng loại từ nhưng KHÔNG phải quan hệ đó ở bất kỳ nghĩa nào. Mỗi distractor có một câu giải thích.`,

  slang: `LOẠI "slang": người học thấy một từ lóng tiếng Anh và chọn nghĩa tiếng Việt đúng theo cách dùng hiện đại. Câu đạt: đáp án phản ánh nghĩa lóng thực tế; <optionCount-1> distractor nghe hợp lý nhưng sai hẳn (không trùng/không diễn giải lại). Mỗi distractor có một câu giải thích.`,

  'odd-one-out': `LOẠI "odd-one-out": người học thấy <optionCount> từ tiếng Anh và chọn từ KHÔNG cùng nhóm. Câu đạt: <optionCount-1> từ trong nhóm (groupWords) rõ ràng chung một phạm trù, còn oddWord thuộc phạm trù hoàn toàn khác (không trùng, không cùng gốc). Mỗi từ trong nhóm có một câu giải thích tương ứng theo thứ tự; oddWord KHÔNG có mảng giải thích riêng.`,

  paragraph: `LOẠI "paragraph": người học đọc một đoạn văn tiếng Anh ngắn (4–7 câu) rồi chọn nhận định ĐÚNG với đoạn trong <optionCount> lựa chọn. Câu đạt: đáp án kiểm chứng được trực tiếp từ một câu cụ thể trong đoạn (diễn đạt lại, không chép nguyên); <optionCount-1> distractor mỗi cái 100% SAI so với đoạn, dài/giọng văn tương đương. Mỗi distractor có một câu giải thích trỏ tới dữ kiện phản bác.`,

  idiom: `LOẠI "idiom": người học thấy một thành ngữ tiếng Anh và chọn nghĩa BÓNG tiếng Việt đúng. Câu đạt: đáp án là nghĩa bóng của cả thành ngữ (không dịch từng chữ); <optionCount-1> distractor là nghĩa của thành ngữ khác hẳn. Mỗi distractor có một câu giải thích.`,

  'verb-use-match': `LOẠI "verb-use-match": chọn collocation động từ + danh từ tự nhiên. Nếu format = "fill-blank": câu có "___" ở chỗ ĐỘNG TỪ, lựa chọn là các động từ, đáp án là verb đúng. Nếu format = "phrase-choice": câu không có "___", lựa chọn là các cụm đầy đủ (sai động từ + cùng danh từ), đáp án là targetPhrase. Câu đạt: chỉ một collocation nghe tự nhiên; <optionCount-1> distractor collocate với danh từ khác. Mỗi distractor có một câu giải thích.`
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

/** FNV-1a 32-bit — seed ổn định cho shuffle (cùng câu → cùng layout, dễ debug/diff). */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher–Yates với LCG deterministic — KHÔNG dùng Math.random để review lặp lại giống nhau. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Một ô lựa chọn sau khi trộn. `srcIndex` = -1 nếu là đáp án đúng, ngược lại là index trong mảng distractor gốc. */
export interface OptionSlot {
  letter: string;
  text: string;
  isCorrect: boolean;
  srcIndex: number;
}

interface TypeOptions {
  correctText: string;
  wrongs: string[];
  wrongExplanations: string[];
  optionTranslations: string[];
  correctAnswerTranslation: string;
}

/** Bóc đáp án / distractor / mảng song song theo quizType. */
function extractOptions(quizType: QuizType, d: Record<string, unknown>): TypeOptions {
  const base: TypeOptions = {
    correctText: asString(d.correctAnswer),
    wrongs: asStringArray(d.wrongAnswers),
    wrongExplanations: asStringArray(d.wrongAnswerExplanations),
    optionTranslations: asStringArray(d.optionTranslations),
    correctAnswerTranslation: asString(d.correctAnswerTranslation)
  };

  switch (quizType) {
    case 'odd-one-out':
      return {
        ...base,
        correctText: asString(d.oddWord),
        wrongs: asStringArray(d.groupWords),
        wrongExplanations: asStringArray(d.groupWordExplanations)
      };
    case 'paragraph':
      return {
        ...base,
        correctText: asString(d.correctStatement),
        wrongs: asStringArray(d.wrongStatements),
        wrongExplanations: asStringArray(d.wrongStatementExplanations)
      };
    case 'verb-use-match':
      return {
        ...base,
        correctText: asString(d.format) === 'fill-blank' ? asString(d.verb) : asString(d.targetPhrase)
      };
    default:
      return base;
  }
}

/** Dựng danh sách ô lựa chọn đã trộn (đáp án KHÔNG cố định ở A). */
function buildOptionLayout(quizType: QuizType, opts: TypeOptions): OptionSlot[] {
  const raw = [
    { text: opts.correctText, isCorrect: true, srcIndex: -1 },
    ...opts.wrongs.map((text, i) => ({ text, isCorrect: false, srcIndex: i }))
  ].filter((slot) => slot.text.length > 0);

  const seed = hashSeed(`${quizType}|${opts.correctText}|${opts.wrongs[0] ?? ''}|${opts.wrongs.length}`);
  return seededShuffle(raw, seed).map((slot, i) => ({ ...slot, letter: LETTERS[i] ?? String(i + 1) }));
}

function renderStem(quizType: QuizType, d: Record<string, unknown>): string {
  switch (quizType) {
    case 'vocab':
      return `STEM: "${asString(d.word)}" có nghĩa là gì?`;
    case 'phrase':
      return `STEM: Cụm từ "${asString(d.phrase)}" có nghĩa là gì?`;
    case 'slang':
      return `STEM: Slang "${asString(d.slang)}" có nghĩa là gì?`;
    case 'idiom':
      return `STEM: Idiom "${asString(d.idiom)}" có nghĩa là gì?`;
    case 'fillblank':
      return `STEM (điền vào ___): ${asString(d.sentence)}`;
    case 'conversation':
      return `HỘI THOẠI (một dòng có ___):\n${asStringArray(d.dialogueLines).join('\n') || asString(d.sentence)}`;
    case 'description':
      return `MÔ TẢ (ngôn ngữ: ${asString(d.descriptionLanguage) || '?'}): ${asString(d.description)}\nSTEM: Từ tiếng Anh nào phù hợp nhất với tình huống này?\nLoại từ cần chọn: ${asString(d.partOfSpeech)}`;
    case 'synonym': {
      const rel = asString(d.questionType) === 'antonym' ? 'trái nghĩa' : 'đồng nghĩa';
      return `STEM: Từ nào là ${rel} của "${asString(d.word)}"?\nLoại từ: ${asString(d.partOfSpeech)}`;
    }
    case 'odd-one-out':
      return `STEM: Từ nào KHÔNG thuộc nhóm với các từ còn lại?`;
    case 'paragraph':
      return `ĐOẠN VĂN: ${asString(d.paragraph)}\nSTEM: Nhận định nào dưới đây ĐÚNG với đoạn văn?`;
    case 'verb-use-match':
      return asString(d.format) === 'fill-blank'
        ? `STEM (điền ĐỘNG TỪ vào ___): ${asString(d.sentence)}`
        : `STEM: ${asString(d.sentence) || 'Cụm từ nào nghe tự nhiên nhất?'}`;
    default:
      return `STEM: (không dựng được learner view cho quizType "${quizType}")`;
  }
}

/**
 * Dựng "màn hình người làm bài" từ questionData đã parse: đề + <optionCount> lựa chọn
 * ĐÃ TRỘN, KHÔNG lộ đâu là đáp án. Trả kèm `layout` để buildAnswerKey ánh xạ giải
 * thích/bản dịch distractor theo đúng letter. Defensive — field thiếu thì bỏ qua.
 */
export function buildLearnerView(
  quizType: QuizType,
  data: Record<string, unknown>
): { view: string; layout: OptionSlot[] } {
  const d = data ?? {};
  const opts = extractOptions(quizType, d);
  const layout = buildOptionLayout(quizType, opts);
  const optionLines = layout.map((slot) => `${slot.letter}. ${slot.text}`).join('\n');

  const view =
    `=== ĐỀ BÀI (người học đọc — CHƯA biết đáp án) ===\n${renderStem(quizType, d)}\n\n` +
    `=== CÁC PHƯƠNG ÁN (đã xáo trộn — tự chọn trước khi xem đáp án) ===\n${optionLines}`;

  return { view, layout };
}

/**
 * Khối đáp án + giải thích — chỉ đọc SAU khi đã tự giải ở STEP 1. Render dạng người
 * đọc (không phải JSON). Giải thích/bản dịch distractor được ánh xạ theo letter đã trộn.
 */
export function buildAnswerKey(quizType: QuizType, data: Record<string, unknown>, layout: OptionSlot[]): string {
  const d = data ?? {};
  const opts = extractOptions(quizType, d);
  const correct = layout.find((s) => s.isCorrect);
  const lines: string[] = ['=== ĐÁP ÁN & GIẢI THÍCH (chỉ đọc SAU khi đã tự giải ở STEP 1) ==='];

  lines.push(`Đáp án đúng: ${correct?.letter ?? '?'} — ${opts.correctText}`);
  const explanation = asString(d.explanation);
  if (explanation) lines.push(`Giải thích (explanation): ${explanation}`);

  for (const slot of layout.filter((s) => !s.isCorrect)) {
    const why = opts.wrongExplanations[slot.srcIndex] ?? '(thiếu giải thích cho phương án này)';
    const gloss = opts.optionTranslations[slot.srcIndex];
    lines.push(`Vì sao "${slot.letter}" sai: ${why}${gloss ? ` (nghĩa: ${gloss})` : ''}`);
  }

  switch (quizType) {
    case 'fillblank':
    case 'conversation':
      if (asString(d.sentenceTranslation))
        lines.push(`Bản dịch câu (đã điền đáp án): ${asString(d.sentenceTranslation)}`);
      if (asString(d.highlightedWord))
        lines.push(`Từ nhấn trong bản dịch (highlightedWord): ${asString(d.highlightedWord)}`);
      if (opts.correctAnswerTranslation)
        lines.push(`Nghĩa đáp án (correctAnswerTranslation): ${opts.correctAnswerTranslation}`);
      break;
    case 'description':
      lines.push(
        `Loại từ (partOfSpeech): ${asString(d.partOfSpeech)} · ngôn ngữ mô tả: ${asString(d.descriptionLanguage)}`
      );
      break;
    case 'synonym':
      lines.push(`Quan hệ cần tìm (questionType): ${asString(d.questionType)} · loại từ: ${asString(d.partOfSpeech)}`);
      break;
    case 'odd-one-out':
      lines.push(`Nhóm chung (groupTheme — người học KHÔNG thấy): ${asString(d.groupTheme)}`);
      break;
    case 'paragraph':
      if (asString(d.translation)) lines.push(`Bản dịch đoạn văn: ${asString(d.translation)}`);
      break;
    case 'verb-use-match':
      lines.push(
        `Dạng (format): ${asString(d.format)} · collocation đúng (targetPhrase): ${asString(d.targetPhrase)} · verb: ${asString(d.verb)} · noun: ${asString(d.noun)}`
      );
      break;
    case 'vocab':
    case 'phrase':
    case 'slang':
    case 'idiom':
      if (asString(d.partOfSpeech)) lines.push(`Loại từ (partOfSpeech): ${asString(d.partOfSpeech)}`);
      break;
    default:
      break;
  }

  const example = asString(d.exampleSentence);
  if (example)
    lines.push(`Câu ví dụ: ${example}${asString(d.exampleTranslation) ? ` — ${asString(d.exampleTranslation)}` : ''}`);

  return lines.join('\n');
}
