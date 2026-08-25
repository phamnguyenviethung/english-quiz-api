# Reading Prompt Guideline

## 1. Mục tiêu

Tạo **micro-reading** cho English learning quiz.

- Mỗi reading được thiết kế để hoàn thành trong khoảng **10 phút**.
- Mỗi reading sẽ được dùng để generate **3 câu hỏi** ở pipeline riêng.
- Ưu tiên daily life, practical English và relatable situations.
- Có thể sử dụng fictional scenarios.
- Reading phải thú vị, tự nhiên và giống tình huống người học có thể gặp.

## 2. Độ dài

**Tất cả CEFR levels đều dùng 150–220 words.**

- A1: 150–220 words
- A2: 150–220 words
- B1: 150–220 words
- B2: 150–220 words

Rules:

- Không kéo dài bài chỉ để đạt word count.
- Ưu tiên nội dung cô đọng, tự nhiên và đủ information để tạo câu hỏi.
- `wordCount` phải nằm trong khoảng 150–220.

## 3. Chủ đề

> Guideline này (mục 1-18) mô tả variant **`daily`** (mặc định). Variant **`academic`** dùng chung mục 2 (độ dài), 11 (sentence complexity theo level) và phần lớn cấu trúc câu hỏi (5-9), nhưng đảo ngược mục 3 và 10 — xem [Academic variant](#academic-variant) ở cuối file.

- Xoay quanh `topic` được input.
- Ưu tiên tình huống cụ thể thay vì chủ đề trừu tượng.
- Cho phép fictional scenarios.
- Ưu tiên daily-life topics: work, school, shopping, food, travel, friends, family, hobbies, technology in daily life, routines, plans, small problems và decisions.
- Tránh science, academic, political, historical hoặc technical topics nếu không được yêu cầu.
- Không yêu cầu kiến thức bên ngoài để hiểu passage hoặc trả lời câu hỏi.

## 4. Nội dung

Mỗi reading chỉ có **một central topic / situation**.

Flow nên tự nhiên:

1. **Situation** — người, nơi chốn, hoàn cảnh.
2. **Development** — problem, action, reason hoặc change.
3. **Result** — outcome, decision, consequence hoặc conclusion.

Passage nên có khoảng **5–7 meaningful information points**, chẳng hạn:

- Character
- Setting
- Action
- Reason
- Problem
- Decision
- Result
- Relevant contextual detail

Rules:

- Details phải liên quan logic với nhau.
- Information phải được phân bố tự nhiên.
- Không tập trung toàn bộ useful information vào một câu.
- Mỗi paragraph nên đóng góp meaningful information.
- Không thêm information chỉ để tăng word count.
- Ưu tiên people, places, actions, problems, reasons và decisions cụ thể.
- Tránh câu chung chung kiểu textbook.
- Passage phải self-contained.

## 5. Question Design Contract

Reading phải được thiết kế để Question Generator có đủ lựa chọn.

Mỗi passage nên hỗ trợ **ít nhất 5–7 potential question points**, dù cuối cùng chỉ dùng 3 câu.

Nên có sự kết hợp giữa:

- 2–3 explicit details
- 1 reason / cause
- 1 inference point
- 1 vocabulary-in-context point
- 1 main idea / purpose
- 1 sequence hoặc cause-effect point khi phù hợp

Không bắt buộc passage phải hỗ trợ tất cả question types.

Rules:

- Question points phải tương đối độc lập.
- Không để toàn bộ passage chỉ xoay quanh một fact.
- Đáp án phải xác định rõ từ passage.
- Không tạo chi tiết mơ hồ chỉ để có thêm question point.
- Readability và questionability quan trọng hơn việc nhồi nhiều information.

## 6. Answerability

Mọi câu hỏi sau này phải answerable **chỉ bằng passage**.

### Detail / comprehension

- Answer phải được stated hoặc paraphrased rõ ràng.

### Inference

- Inference phải được hỗ trợ bởi ít nhất **2 clues** trong passage.
- Không yêu cầu người đọc đoán quá xa.

### Reason / cause-effect

- Passage phải thể hiện rõ relationship giữa cause và action/result.

### Vocabulary in context

- Context phải cung cấp đủ clues để hiểu meaning.

Không dựa vào:

- Kiến thức bên ngoài.
- Opinion không có evidence.
- Information không được đề cập.
- Inference quá xa.
- Chi tiết không thể xác định rõ.

> Every question should have a defensible answer, not merely a plausible answer.

## 7. Question Independence

3 questions của cùng một reading phải có thể trả lời độc lập.

- Question 2 không cần biết answer của Question 1.
- Question 3 không cần biết answer của Question 1 hoặc 2.
- Không để một question reveal trực tiếp answer của question khác.
- Không tạo 3 câu hỏi chỉ khác wording nhưng hỏi cùng một information point.
- Ưu tiên 3 câu khai thác 3 information points khác nhau.

## 8. Question Diversity

Reading nên hỗ trợ ít nhất **2–3 dimensions**:

- Detail / comprehension
- Reason / cause-effect
- Inference
- Vocabulary in context
- Sequence
- Main idea / purpose

Không bắt buộc mỗi reading phải có tất cả.

Tránh mặc định:

- 3 detail questions
- 3 vocabulary questions
- 3 câu hỏi về cùng một event

## 9. Distractor Readiness

Nếu Question Generator tạo MCQ, passage nên có material để tạo distractors tự nhiên.

Distractors có thể dựa trên:

- Information thật nhưng sai đối tượng.
- Information thật nhưng sai thời điểm.
- Action có thật nhưng không phải answer.
- Paraphrase gần nghĩa nhưng không chính xác.

Không tạo distractors bằng information không có trong passage.

Distractors không được:

- Vô lý rõ ràng.
- Quá khác về độ dài/cấu trúc.
- Làm question ambiguous.
- Có thể cùng được xem là correct answer.

## 10. Vocabulary

- Vocabulary phải phù hợp CEFR.
- Phần lớn từ vựng nên quen thuộc với learner.
- Có thể dùng một số useful/challenging words phù hợp level.
- Ưu tiên vocabulary có giá trị sử dụng trong đời sống.
- Không nhồi từ khó chỉ để tạo vocabulary questions.
- Không dùng academic vocabulary nếu topic không cần.

Nếu passage có vocabulary-in-context potential:

- Có khoảng 1–3 useful target words.
- Context phải cung cấp clues để đoán meaning.
- Không chọn obscure words.
- Không chọn từ có nhiều meanings phù hợp ngang nhau.
- Không dùng proper nouns làm vocabulary target.

## 11. Sentence Complexity

### A1 / A2

- Ưu tiên câu ngắn.
- Dùng cấu trúc phổ biến.
- Tránh nhiều embedded clauses.
- Grammar complexity phải thấp.

### B1

- Cho phép compound và complex sentences ở mức vừa phải.
- Có thể dùng connectors và mô tả chi tiết hơn.

### B2

- Cho phép cấu trúc phức tạp hơn.
- Có thể dùng nuanced language và sentence patterns đa dạng hơn.
- Vẫn phải tự nhiên và dễ đọc.

General:

- Không biến passage thành chuỗi câu dài và khó đọc.
- Không dùng grammar vượt quá level quá thường xuyên.
- CEFR level nên thể hiện qua vocabulary + sentence complexity + discourse, không chỉ bằng từ khó.

## 12. Naturalness

English phải tự nhiên và giống cách native speakers thực sự viết.

- Có thể dùng dialogue khi phù hợp.
- Fictional names, places và situations được phép.
- Ưu tiên conversational / practical language.
- Tránh textbook style.
- Tránh formal language nếu context không yêu cầu.
- Tránh wording quá generic hoặc AI-generated.
- Dialogue phải phục vụ situation, không thêm chỉ để tạo variety.

## 13. Variety

Không lặp lại cùng một plot giữa các readings.

Tránh liên tục dùng:

- Someone forgot...
- Someone went to...
- Someone decided...

Vary:

- Characters
- Settings
- Problems
- Actions
- Reasons
- Outcomes
- Narrative style

Cùng một topic có thể được khai thác qua nhiều situations khác nhau.

## 14. Ambiguity Prevention

- Pronouns phải có antecedent rõ ràng.
- Không để hai characters đều có thể là subject của một action.
- `they`, `it`, `this`, `that` phải có reference rõ.
- Sequence phải rõ khi thứ tự sự kiện quan trọng.
- Cause và result phải phân biệt được.
- Không dùng wording có thể dẫn tới hai interpretations hợp lý.
- Không để hai facts quá giống nhau khiến answer hoặc distractor bị ambiguous.

## 15. Question Point Density

Dùng heuristic:

> Khoảng mỗi **40–60 words** nên có ít nhất một meaningful question point.

Đây không phải hard rule.

Mục tiêu là passage 150–220 words phải có đủ lựa chọn để Question Generator chọn **3 câu tốt nhất**, thay vì bị ép sử dụng một vài details duy nhất.

## 16. Không tạo quiz ở Reading Generation step

Reading Generator **chỉ tạo reading**.

Không generate questions trong cùng output.

Pipeline:

```text
Input: topic + CEFR
        ↓
Reading Generator
        ↓
Reading Validator
        ↓
Save Reading
        ↓
Question Generator
        ↓
Question Validator
        ↓
Save Questions
```

Reading Generator phải đảm bảo passage **question-friendly**, nhưng không tự tạo questions.

## 17. Output

Output phải là structured JSON:

```json
{
  "title": "...",
  "paragraphs": ["...", "...", "..."],
  "wordCount": 180,
  "topic": "...",
  "cefrLevel": "B1"
}
```

Rules:

- Chỉ trả về JSON.
- Không markdown.
- Không explanation ngoài JSON.
- `wordCount` phải phản ánh số từ thực tế.
- `wordCount` phải nằm trong khoảng 150–220.
- `cefrLevel` phải đúng với input.
- `paragraphs` phải tạo thành một passage coherent.

## 18. Quality Checklist

Trước khi output:

- [ ] 150–220 words.
- [ ] Đúng CEFR level.
- [ ] Bám đúng topic.
- [ ] Daily-life / practical / relatable.
- [ ] Có một central situation.
- [ ] Có clear situation → development → result.
- [ ] Có khoảng 5–7 meaningful information points.
- [ ] Có ít nhất 5–7 potential question points.
- [ ] Có thể tạo 3 câu hỏi độc lập.
- [ ] Answers có thể xác định rõ từ passage.
- [ ] Không cần external knowledge.
- [ ] Không có accidental ambiguity.
- [ ] Vocabulary phù hợp CEFR.
- [ ] Sentence complexity phù hợp CEFR.
- [ ] Natural English.
- [ ] Không textbook-like.
- [ ] Không lặp plot quá nhiều.
- [ ] Không thêm filler chỉ để đạt word count.
- [ ] JSON output hợp lệ.

## Core Principle

> **Generate a natural, self-contained 150–220-word reading that is interesting on its own and contains enough clear, well-distributed information for a separate Question Generator to produce 3 independent, unambiguous, high-quality questions.**

## Academic variant

`type = 'academic'` (`prompt/reading-passage-prompt-academic.ts`, duplicate-và-sửa từ `prompt/reading-passage-prompt.ts`). `topic` vẫn là input y hệt variant `daily` — chỉ nội dung/văn phong khác. Sửa academic thì sửa cả 2: guideline (đoạn này) và file prompt.

Khác biệt so với `daily` (mục 1-18 ở trên):

- **Mục 1 (Mục tiêu)**: expository "micro-reading" (encyclopedia entry / textbook excerpt / science-magazine snippet), không phải narrative story.
- **Mục 3 (Chủ đề)**: **đảo ngược** — chủ động giải thích khoa học/lịch sử/kỹ thuật/xã hội đúng như `topic` gọi tên, thay vì tránh. Ưu tiên fact tổng quát, đã được xác lập rộng rãi; **không** bịa số liệu/ngày tháng/tên nghiên cứu/tên người thật cụ thể — dùng cách diễn đạt an toàn ("scientists have found that...") khi cần. Không viết narrative/dialogue/personal story.
- **Mục 4 (Nội dung) / cấu trúc**: arc đổi từ Situation → Development → Result thành **Overview → Explanation → Significance**. Information points là fact/cause/process-step/comparison/consequence thay vì character/setting/decision.
- **Mục 10 (Vocabulary)**: **đảo ngược** — khuyến khích từ vựng academic/topic-specific thay vì tránh; target word có thể là thuật ngữ miễn nghĩa suy được từ ngữ cảnh.
- **Mục 12 (Naturalness)**: văn phong "well-edited educational text" — trang trọng, rõ ràng, tránh textbook-cliché filler, không phải "avoid formal language" như bản daily.
- **Mục 13 (Variety)**: câu mở tránh dùng là dạng expository-cliché ("Have you ever wondered...", "Did you know that...") thay vì narrative-cliché.
- Mọi mục còn lại (2, 5-9, 11, 14-18) giữ nguyên tinh thần, chỉ đổi từ vựng minh hoạ (character → entity, plot → sub-topic, ...).
