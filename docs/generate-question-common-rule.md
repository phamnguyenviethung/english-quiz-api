# English Quiz — Question Generation Guidelines

Tài liệu này định nghĩa các nguyên tắc chung để AI tạo câu hỏi, đáp án, và giải thích cho mọi loại quiz tiếng Anh. Mỗi loại quiz mới phải tuân theo các nguyên tắc này trước khi bổ sung rule riêng.

---

## 1. Kiến trúc tổng quan

```
[Base Prompt của từng loại quiz]  +  [Difficulty Instruction]  +  [Batch / Topic tùy chọn]
        ↓
   Model API (structured output)
        ↓
   JSON response → validate (Zod) → trả về client hoặc ghi pool
```

Mỗi loại quiz có một file prompt riêng (`*-prompt.ts`). Tất cả đều nhận thêm `DifficultyInstruction` (từ `difficulty-prompt`) append vào cuối để cá nhân hóa độ khó theo `DifficultyContext`.

Prompt có thể được gọi ở chế độ **đơn** (`count = 1`) hoặc **batch** (`count` từ 2 tới 5): batch dùng cho cron pre-generate và `study.service.generateXxxBatch`.

---

## 2. Difficulty System

Mọi quiz đều nhận `DifficultyContext` (định nghĩa trong `vocab-prompt.ts`, re-export qua `study.service`):

```ts
interface DifficultyContext {
  engLevel: 'A1' | 'A2' | 'B1' | 'B2'; // trình độ CEFR
  optionCount: 3 | 4 | 5; // tổng số lựa chọn (gồm đáp án đúng)
  show5050: boolean;
  model: ModelName;
}
```

**Không còn `userLevel`** trong context: độ khó và văn phong do **`engLevel`** + **`optionCount`** + hướng dẫn trong `buildDifficultyInstruction` quyết định.

### engLevel — Ảnh hưởng đến từ vựng và distractor

| Level | Từ vựng                      | Distractor                       |
| ----- | ---------------------------- | -------------------------------- |
| A1    | Rất phổ biến, hàng ngày      | Rõ ràng khác nhau, dễ loại       |
| A2    | Thường dùng trong hội thoại  | Plausible nhưng phân biệt được   |
| B1    | Trung cấp, học thuật nhẹ     | Near-synonym, cần suy nghĩ       |
| B2    | Nâng cao, idiom, collocation | Cực gần nghĩa, chỉ khác sắc thái |

### Specialized/Technical Override

Nếu từ là thuật ngữ chuyên ngành (y tế, pháp lý, khoa học...) → **bỏ qua mọi difficulty setting**, dùng cài đặt đơn giản nhất: giải thích dễ hiểu, distractor rõ ràng, câu ví dụ thường ngày.

### optionCount

- `wrongAnswerCount = optionCount - 1`
- Mọi array distractor phải có đúng `wrongAnswerCount` phần tử, không thừa không thiếu

---

## 3. Tham số batch và topic trên prompt

Các builder prompt (ví dụ `buildVocabPrompt`, `buildPhrasePrompt`, …) nhận `options` kiểu:

- **`count?: number`**: mặc định `1`. Khi `count > 1`, prompt yêu cầu sinh đúng số câu độc lập và đổi hướng dẫn output (xem mục 4).
- **`topic?: string`**: khi có, chèn khối **TOPIC LOCK** — đây là **ràng buộc cứng (hard constraint)**, không phải gợi ý. Từ/cụm từ/ngữ cảnh trung tâm của câu hỏi phải thuộc domain của topic. Field `exampleSentence` và scenario phải đặt trong ngữ cảnh của topic. `wrongAnswers` và `wrongAnswerExplanations` được **miễn** — chúng chỉ cần là distractor hợp lý, không cần bám topic.
  - **Ngoại lệ `slang`**: topic chỉ ràng buộc `exampleSentence` và context của `explanation`, không ràng buộc việc chọn slang term (slang không domain-specific).
  - **Ngoại lệ `reading`**: topic ràng buộc việc chọn scenario từ SCENARIO POOL, không ảnh hưởng đến distractor tactics hay math computation.
  - **`odd-one-out`**: topic ràng buộc mạnh nhất — `groupTheme` phải là sub-category trực tiếp của topic.
- **`excludeWords` / `excludePhrases` / …** (tùy loại): vẫn dùng để tránh trùng nội dung gần đây (realtime).

`BatchGenerateOptions` trong `study.service.ts`:

```ts
interface BatchGenerateOptions {
  count: number;
  topic?: string;
  excludeWords?: string[];
}
```

Cron job pool truyền `topic` = tên topic (`topicName`) khi generate batch.

---

## 4. Định dạng output JSON

- **`count === 1`**: một **object** đúng schema loại quiz (một câu), ví dụ trực tiếp các field `word`, `correctAnswer`, …
- **`count > 1`**: một object bọc ngoài:

```json
{
  "questions": [/* mảng đúng `count` phần tử, mỗi phần tử cùng schema một câu */]
}
```

Schema Zod tương ứng: `z.object({ questions: z.array(...).min(1).max(5) })`.

Parser/service map mảng `questions` sang nhiều bản ghi pool hoặc nhiều object trong memory.

---

## 5. Quy tắc chung (chất lượng — áp dụng mọi chế độ)

### 5.1 Câu hỏi / context phải đủ để thu hẹp về 1 đáp án

Dù là câu đơn, cụm từ, hay hội thoại — context phải đủ gợi ý để **chỉ có đúng 1 lựa chọn** là hợp lý. Câu quá chung mà nhiều đáp án đều nghe được là không hợp lệ.

### 5.2 Distractor phải sai rõ ràng trong context đó

Wrong answer không được mơ hồ hay "đúng ở một nghĩa nào đó". Trước khi chốt mỗi distractor, AI phải tự hỏi: _"Có ngữ cảnh nào mà đáp án này đúng không?"_ — nếu có → loại bỏ.

### 5.3 wrongAnswerExplanation phải tham chiếu context cụ thể

Không giải thích chung chung kiểu "nghĩa khác nhau". Phải chỉ ra: đáp án sai mô tả điều gì, và yếu tố nào trong câu/ngữ cảnh chứng minh nó sai.

### 5.4 explanation ngắn, thân thiện, không ví dụ

- 1–2 câu tiếng Việt, dễ hiểu
- Không chứa câu ví dụ (đã có `exampleSentence` riêng)
- Không dùng markdown (không `**bold**`, không `*italic*`)

### 5.5 exampleSentence phải là ngữ cảnh thường ngày

Câu ví dụ phải gần gũi: bạn bè, gia đình, công việc, học hành, mua sắm, sức khỏe, mạng xã hội... Ngay cả từ học thuật cũng phải đặt vào tình huống thực tế người dùng Việt hay gặp. Không được trùng với câu trong quiz.

### 5.6 Không dùng proper noun

`correctAnswer`, tất cả `wrongAnswers`, và nội dung câu hỏi không được là proper noun (tên người, thương hiệu, địa danh). Nếu từ đầu vào là proper noun → dùng nghĩa thông thường của nó.

### 5.7 Output là JSON thuần, không markdown

AI chỉ trả về JSON hợp lệ. Mọi string bên trong không chứa markdown formatting.

---

## 6. Quy tắc riêng khi batch (`count > 1`)

### 6.1 Độc lập và khử trùng lặp giữa các câu

- Mỗi phần tử trong `questions` là một câu hỏi **độc lập** (không copy nguyên khối prompt ví dụ sang câu khác).
- **Không trùng** từ khóa trung tâm (ví dụ field `word`, `phrase`, `slang`, …) giữa các câu trong cùng batch.
- Tránh lặp **cùng một khái niệm** dưới dạng diễn đạt khác (synonym parade) trừ khi loại quiz bắt buộc.

### 6.2 Chất lượng từng phần tử

Mọi mục trong mảng phải thỏa **đầy đủ** các quy tắc mục 5 — **như thể từng câu được sinh riêng lẻ**. Cụ thể:

- Mỗi câu phải có quá trình chọn từ/cụm từ/ngữ cảnh riêng biệt, không tái dùng cấu trúc của câu trước
- Mỗi `wrongAnswerExplanation` phải cụ thể cho câu đó — không được rút gọn hay copy pattern từ item khác trong batch
- Mỗi `exampleSentence` phải là ngữ cảnh mới, không trùng setting hay cấu trúc câu với các item khác
- Không được “câu đầu kỹ, câu sau ẩu”

**Batch failure patterns phổ biến cần tránh:**

- Dùng lại cùng một tập wrong answer candidates cho nhiều câu trong batch
- Tất cả `exampleSentence` có cùng cấu trúc câu hoặc setting
- Chọn các từ trung tâm là synonym hoặc cùng semantic cluster
- Bỏ qua bước self-verification cho các item 2 trở đi

### 6.3 Ràng buộc topic trên toàn batch

Khi có `topic`, **tất cả** câu trong `questions` phải bám đúng topic (theo TOPIC LOCK block trong prompt); không xen câu lạc đề.

Ràng buộc topic áp dụng cho **từ/cụm từ trung tâm và `exampleSentence`** — không áp dụng cho `wrongAnswers` và `wrongAnswerExplanations` (những trường này cần là distractor tự nhiên, không bị ép vào topic).

### 6.4 Đúng số lượng

Số phần tử trong `questions` phải **đúng bằng `count`** được yêu cầu (trong giới hạn 1–5 mà service clamp).

---

## 7. Các loại quiz và file prompt

| Loại         | File                     | Ghi chú                                                                                                                                                                                                                     |
| ------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocab        | `vocab-prompt.ts`        | Batch + topic + excludeWords                                                                                                                                                                                                |
| Phrase       | `phrase-prompt.ts`       | Tương tự                                                                                                                                                                                                                    |
| Fill-blank   | `fill-blank-prompt.ts`   | Tương tự                                                                                                                                                                                                                    |
| Conversation | `conversation-prompt.ts` | Tương tự                                                                                                                                                                                                                    |
| Description  | `description-prompt.ts`  | Batch + topic + excludeWords. `description` là clue-only, không chứa câu hỏi UI hay bản dịch đáp án; handler tự thêm câu hỏi chọn vocab English phù hợp. A1 ~70% mô tả tiếng Việt, A2 ~50%, B1/B2 chỉ tiếng Anh.            |
| Synonym      | `synonym-prompt.ts`      | Tương tự                                                                                                                                                                                                                    |
| Slang        | `slang-prompt.ts`        | Tương tự                                                                                                                                                                                                                    |
| Odd-one-out  | `odd-one-out-prompt.ts`  | Tương tự                                                                                                                                                                                                                    |
| Reading      | `reading-prompt.ts`      | Có `generateReadingBatch` trong service (dùng khi tích hợp loại này vào flow)                                                                                                                                               |
| Idiom        | `idiom-prompt.ts`        | Batch + topic + excludeWords. Không có `partOfSpeech`. 8 category rotation (difficulty, communication, work, relationships, money, emotions, time, decisions). Topic lock chỉ ràng buộc `idiom` field và `exampleSentence`. |

Chi tiết rule riêng từng field nằm trong từng file prompt.

---

## 8. Liên hệ với pool và cron

- Worker `question-gen.job.ts` gọi `generateXxxBatch` với `count` và `topic` (tên topic).
- Mỗi câu trong batch được stringify riêng và `push` vào `english_question_pool` với cùng `topicId` bucket.

Như vậy guideline chung (mục 5–6) là hợp đồng chất lượng cho cả **realtime** (thường `count = 1`) và **pre-generate batch**.

---

## 9. Beginner mode

Câu beginner (bucket `forBeginner`, ≤ B1, ≤ 4 đáp án) dùng **cùng base prompt** của loại quiz, nhưng khối cuối là `buildBeginnerInstruction` (`prompt/beginner-prompt.ts`) thay cho `buildDifficultyInstruction`: bỏ EXPERT LEARNER MODE, bỏ DOMAIN A–G / danh sách từ bị cấm, dùng từ vựng thường ngày theo wordlist + sách giáo khoa Cambridge, distractor khác nghĩa rõ ràng. Chọn khối qua `buildLevelInstruction(ctx, quizType)` ở `study.service.ts`. Chi tiết: [`beginner.md`](./beginner.md).

## 10. Sibling question (câu tương tự)

`prompt/sibling-prompt.ts` (`buildSiblingPrompt`) tái dùng **nguyên** hợp đồng chất lượng mục 5–6, thêm ràng buộc: **khóa nguyên văn** term cần học + độ khó (CEFR) + topic lấy từ một câu pool gốc thật; chỉ sinh mới ngữ cảnh / distractor / ví dụ / giải thích và bắt buộc khác rõ rệt so với câu gốc. Chỉ 9 quizType có term trung tâm được hỗ trợ. Chi tiết ở [`sibling-question.md`](./sibling-question.md).
