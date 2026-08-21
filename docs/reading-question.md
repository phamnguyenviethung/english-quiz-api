# Reading Question

Câu hỏi đọc hiểu trắc nghiệm sinh bằng LLM **từ một bài đọc đã lưu** trong `english_reading_passages`.

Nguồn quy tắc nội dung: [`question-generator-guideline.md`](./question-generator-guideline.md). Sửa guideline thì sửa `prompt/reading-question-prompt.ts` theo.

> **Ba pipeline reading khác nhau, đừng nhầm:**
>
> |                                                                | Sinh ra gì                                         | Bảng                        |
> | -------------------------------------------------------------- | -------------------------------------------------- | --------------------------- |
> | `quizType = 'reading'` (`prompt/reading-prompt.ts`)            | Quiz đọc hiểu + mental math, tự sinh context riêng | `english_question_pool`     |
> | Reading passage ([`reading-passage.md`](./reading-passage.md)) | Bài đọc thuần, chưa có câu hỏi                     | `english_reading_passages`  |
> | **Reading question (file này)**                                | Câu hỏi sinh từ bài đọc ở trên                     | `english_reading_questions` |

## Mô hình dữ liệu

Bảng `english_reading_questions`:

| Cột                                   | Ghi chú                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `passageRefId`                        | FK → `english_reading_passages.id`, **ON DELETE CASCADE**                  |
| `quizType`                            | 1 trong 19 type ở `readingQuestionTypes.ts`, bị giới hạn theo CEFR level   |
| `question`                            | Câu hỏi (tiếng Anh)                                                        |
| `options`                             | `jsonb` — đúng 4 đáp án                                                    |
| `correctAnswer`                       | **Index 0-based** vào `options`, không phải chữ cái, không phải nội dung   |
| `explanation`                         | 1 câu tiếng Việt, trỏ tới đoạn chứa evidence                               |
| `cefrLevel` / `topicId` / `topicName` | Snapshot từ passage để list/filter không phải join                         |
| `model`, `tokenIn`, `tokenOut`        | Truy vết chi phí (token của cả batch, lặp trên mỗi dòng)                   |
| `isActive`                            | Tắt câu kém mà không xoá. Câu đã tắt **không** tính là "bài đã có câu hỏi" |

Cột thêm vào `english_reading_passages`: `questionGenAttempts` — xem [Chống lặp vô hạn](#chống-lặp-vô-hạn).

## Bucket = 1 bài đọc

Đây là **khác biệt cấu trúc lớn nhất** so với 2 pipeline kia:

| Pipeline             | Bucket                          | `bucketKey`  |
| -------------------- | ------------------------------- | ------------ |
| Question pool        | `(engLevel, quizType, topicId)` | `B1:7:vocab` |
| Reading passage      | `(cefrLevel, topicId)`          | `B1:7`       |
| **Reading question** | **1 passage**                   | **`rq:42`**  |

Một bài hoặc đã đủ `questionsPerPassage` câu, hoặc chưa — không có khái niệm "bucket 3 chiều" ở đây.

Hệ quả: `englishCronJobTracking.startBucket()` tự tính `bucketKey` từ `(engLevel, topicId, quizType)`, nên pipeline này **phải truyền `bucketKey` override**. Không truyền thì mọi bài cùng level + topic đụng chung một key và lịch sử cron không phân biệt được. Field `bucketKey?` là optional nên 2 pipeline cũ giữ nguyên hành vi.

Scan (`scanReadingQuestionBuckets`) **không** dùng `getLastBucketRefillTimestamps` làm tie-break như 2 pipeline kia. Tie-break đó chống đói cho bucket cần refill vĩnh viễn (pool bị pop liên tục); một passage thì fill đúng một lần rồi biến mất khỏi scan. Thứ tự: `deficiency` giảm dần → `passageId` tăng dần (bài cũ trước).

## Quiz type và giới hạn theo CEFR

`readingQuestionTypes.ts` khai 19 type (guideline mục 3). `CEFR_ALLOWED_QUESTION_TYPES` chép nguyên văn allow-list ở **guideline mục 2.5**:

| Level | Type được phép                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1    | `detail`, `reason`, `sequence`, `result`, `vocabulary_context`                                                                                   |
| A2    | + `main_idea`                                                                                                                                    |
| B1    | `detail`, `reason`, `cause_effect`, `sequence`, `main_idea`, `vocabulary_context`, `inference`, `purpose`                                        |
| B2    | `detail`, `main_idea`, `purpose`, `cause_effect`, `inference`, `vocabulary_context`, `comparison`, `attitude`, `specific_function`, `prediction` |

**6 type chưa mở**: `true_false`, `negative_detail`, `matching`, `best_title`, `paraphrase`, `reference`. Guideline định nghĩa chúng ở mục 3 nhưng **không** liệt kê ở bất kỳ level nào trong mục 2.5. Chúng vẫn nằm trong enum (admin sửa tay được, để dành mở sau) nhưng không bao giờ được đưa vào prompt.

Type do **server chọn trước** theo `CEFR_COMPOSITION_SLOTS` (guideline mục 7), mỗi slot random 1 type:

| Level | Slot 1   | Slot 2                                     | Slot 3                                                                   |
| ----- | -------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| A1    | `detail` | `reason` \| `result`                       | `vocabulary_context`                                                     |
| A2    | `detail` | `reason` \| `sequence` \| `result`         | `vocabulary_context` \| `main_idea`                                      |
| B1    | `detail` | `reason` \| `cause_effect`                 | `inference` \| `vocabulary_context` \| `main_idea`                       |
| B2    | `detail` | `inference` \| `cause_effect` \| `purpose` | `vocabulary_context` \| `main_idea` \| `attitude` \| `specific_function` |

Slot đầu luôn là `detail` — câu neo, bài nào cũng đỡ được. Random trong slot nên mỗi lần retry một bài hỏng sẽ ra tổ hợp khác, hợp với trần `questionGenAttempts`.

Nhờ vậy **diversity là đảm bảo cứng**, không còn phụ thuộc model tự giác như bản 1-call trước đây.

**Cố tình tách khỏi `QUIZ_TYPES`** ở `questionTypes.ts`: 11 quizType kia là các quiz độc lập có prompt riêng, phân phối riêng (`quiz_distribution`) và pool riêng. Trộn 2 tập sẽ vỡ `pickQuizType()`, `generateByType()` và config phân phối.

## Mỗi câu một lời gọi LLM

Sinh 1 câu = 1 lần gọi, prompt chuyên biệt cho đúng type đó. Chạy **tuần tự**, câu trước được truyền vào câu sau làm exclusions.

```
server chọn [detail, reason, vocabulary_context]
  ↓
call 1  detail-prompt      + bài đọc                → Q1
call 2  reason-prompt      + bài đọc + [Q1]         → Q2
call 3  vocab-prompt       + bài đọc + [Q1, Q2]     → Q3
  ↓
validate cả bộ → xáo vị trí đáp án → all-or-nothing
```

Cấu trúc prompt ở `prompt/reading-question/`:

| File              | Vai trò                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `common.ts`       | Phần không phụ thuộc type: bài đọc, cấm nhắc số đoạn, distractor chung, self-check chung, quality constraints, block độc-lập-với-câu-đã-có |
| `types/<type>.ts` | 13 module, mỗi cái có `role` / `evidence` / `method` / `distractors` / `selfCheck` / `example` / `pitfalls`                                |
| `index.ts`        | Ghép common + đúng 1 module, cộng invariant assert                                                                                         |

**Chỉ 13 module** cho các type nằm trong `CEFR_ALLOWED_QUESTION_TYPES`. 6 type còn lại không level nào cho phép nên không bao giờ được chọn — viết module cho chúng là code chết. `index.ts` assert lúc import: mở type mới trong allow-list mà quên viết module thì fail ngay lúc khởi động, không phải lúc cron chạy 6h sáng.

### Không có đường từ chối

Bản đầu của thiết kế này cho model trả `{ "question": null }` khi bài thiếu evidence — nghe có nguyên tắc, nhưng **đo thực tế thì hỏng**: `gemini-2.5-flash-lite` vin vào đó để né cả `detail`, đẩy tỉ lệ reject cả bộ lên 30-60%. `gpt-4.1-nano` cùng bài lại làm được 3/3.

Sửa prompt cho gắt hơn **không đủ** — nguyên nhân thật nằm ở **Zod schema**: `ReadingQuestionDraftSchema.nullable()` được đổi thành JSON Schema của tool, nên `null` là giá trị hợp lệ ngay trong chữ ký hàm. Bỏ `.nullable()` thì tỉ lệ pass lên **100%** (10/10 bộ).

Bài học: với model yếu, đường thoát nằm trong _schema_ mạnh hơn mọi câu chữ trong prompt.

## Xáo vị trí đáp án ở server

`spreadCorrectAnswers` xáo lại `options` của từng câu (và remap `correctAnswer`) sau khi cả bộ đã hợp lệ.

Cần thiết vì mỗi câu sinh riêng nên model không thể "rải vị trí đáp án đúng" giữa các câu như prompt 1-call cũ yêu cầu — đã gặp lần cả 3 câu cùng rơi vào B. Xáo ở server biến việc này từ _nhờ model_ thành _chắc chắn_, và không tốn token.

## All-or-nothing

`generateReadingQuestionSet` trả **mảng rỗng** nếu bất kỳ câu nào hỏng, chứ không trả bộ thiếu. Dừng ngay ở câu hỏng, không gọi tiếp các câu sau.

Lý do: guideline mục 2.3 (3 câu phải độc lập nhau) là thuộc tính của **cả bộ**, không phải của từng câu. Log ghi rõ type nào hỏng (`"inference" failed`) để soi được type nào hay có vấn đề.

Validate 3 tầng:

1. **Zod** — shape: đúng 4 option, `correctAnswer` trong `[0,3]`, quizType thuộc enum.
2. **`isValidReadingQuestionDraft`** (từng câu):
   - `quizType` phải **khớp đúng type server giao** — model được giao `inference` mà trả `detail` là không làm đúng việc
   - option không rỗng và không trùng nhau
   - `question` không trùng câu đã có
   - **không được nhắc số thứ tự đoạn** trong `question`/`options`
3. **`isValidReadingQuestionSet`** (cả bộ): không có 2 câu **cùng đáp án đúng** — bù cho việc mỗi câu sinh riêng nên model không thấy các câu khác. Hai câu cùng đáp án gần như chắc chắn đang hỏi cùng một thông tin.

Điểm về số đoạn cần giải thích: prompt đánh số đoạn `[1] [2]` để model neo explanation vào đúng đoạn, nhưng người học đọc bài dạng văn xuôi **không có số**. Cấm ở `question`/`options`, cho phép ở `explanation` (field cho admin review).

`temperature = 0.7`, thấp hơn reading passage (0.95) có chủ ý: ở đây cần đúng đáp án và đúng evidence, phần variety đã do bài đọc gánh.

## Chi phí

Đo thật trên bài A1 ~150 từ, `questionsPerPassage = 3`:

|                                  | Token vào | Token ra |
| -------------------------------- | --------- | -------- |
| 1 call cho cả 3 câu (bản cũ)     | ~2350     | ~280     |
| 3 call, mỗi câu 1 lần (hiện tại) | **~6300** | **~300** |

**~2.5x tổng token.** Không phải 3x vì prompt cũ phải render playbook của 5-10 type cùng lúc, còn giờ mỗi call chỉ render 1 module.

Độ trễ ~4-5s cho 1 bộ (3 call tuần tự). `job_flags.readingQuestionRefillMaxPerRun` đếm theo **câu hỏi** nên trần chi phí mỗi lượt vẫn tự đúng.

Muốn giảm chi phí thì hạ `reading_question.questionsPerPassage` xuống 2 — không phải sửa code.

## Chống lặp vô hạn

Bài quá mỏng thì model sinh mãi không nổi đủ câu. Không chặn thì cron gọi lại bài đó mỗi lần chạy, vĩnh viễn, và đốt token.

`english_reading_passages.questionGenAttempts` đếm số lần sinh **hỏng**, tăng ở cả 2 nhánh:

- LLM call throw
- batch bị reject vì không đủ câu hợp lệ (all-or-nothing)

Insert thành công thì reset về 0. Scan bỏ qua bài có `questionGenAttempts >= reading_question.maxGenerationAttempts` (mặc định 3).

## Sửa bài đọc → câu hỏi cũ thành rác

`PATCH /admin/readings/:id` mà **có `paragraphs`** sẽ, trong cùng transaction:

1. Set `isActive = false` cho mọi câu hỏi của bài
2. Reset `questionGenAttempts = 0`

Câu hỏi cũ neo vào evidence trong đoạn văn cũ; đổi nội dung là làm chúng sai. Tắt (không xoá) để admin còn xem lại, và scan sẽ tự thấy bài thiếu câu rồi sinh lại ở lần chạy sau. Sửa mỗi `title` hoặc `isActive` thì không đụng gì.

Xoá hẳn passage thì câu hỏi đi theo qua `ON DELETE CASCADE`.

## Config

Namespace `reading_question` (category `reading` trong UI cấu hình):

| Key                                                | Mặc định    | Ý nghĩa                              |
| -------------------------------------------------- | ----------- | ------------------------------------ |
| `questionsPerPassage`                              | 3           | Số câu mục tiêu mỗi bài              |
| `perPassageGenerationCap`                          | 3           | Trần số câu sinh mỗi lượt chạm 1 bài |
| `maxGenerationAttempts`                            | 3           | Quá ngưỡng này thì scan bỏ qua bài   |
| `manualFillMinCount` / `MaxCount` / `DefaultCount` | 1 / 50 / 10 | Biên số **bài** khi admin trigger    |
| `manualFillConcurrency`                            | 2           | Số bài chạy song song khi manual     |

`questionsPerPassage` và `perPassageGenerationCap` bị chặn `max 5` ngay ở Zod schema vì `ReadingQuestionBatchSchema` cap `.max(5)` — đặt lớn hơn sẽ làm cả lần gọi model fail validation. (Đây là cái bẫy đang tồn tại ở `reading_passage.perBucketGenerationCap`, namespace này chặn sẵn.)

`job_flags`: `readingQuestionRefillEnabled` (bật/tắt cron), `readingQuestionRefillMaxPerRun` (mặc định 60 — **đơn vị là câu hỏi**, mỗi bài ăn 3 câu).

`reading_question_refill_schedule.items`: mặc định `[{ name: 'reading-question-refill-daily', cron: '30 6 * * *' }]` — chạy 30 phút sau `reading-refill-daily` (`0 6 * * *`) để bài sinh sáng nay có câu hỏi ngay trong buổi sáng. Đổi giá trị này reconcile BullMQ job scheduler **ngay lập tức**, không cần restart.

## Jobs

Hai đường, cùng dùng `fillReadingQuestionBucketDetailed` (`core/cron/reading-question-gen.job.ts`):

**Cron (`jobKey = reading_question_refill`)** — parent queue `english-reading-question-refill` scan bài thiếu câu → tạo BullMQ flow, mỗi bài là 1 child ở `english-reading-question-refill-child` (concurrency 2). Chịu trần `readingQuestionRefillMaxPerRun`.

**Manual (`jobKey = reading_question_manual_fill`)** — `POST /admin/reading-questions/refill`, chạy in-process với bounded concurrency, **bỏ qua** trần per-run vì đây là hành động admin chủ động.

`buildRefillPlan` dùng chung với question pool (`poolRefill.service.ts`) — hàm generic trên `{ deficiency: number }`, ở đây `perBucketCap` = số câu tối đa cho 1 bài, `maxQuestionsPerRun` = tổng số câu cả lượt.

Tracking dùng chung bảng `english_cron_job_*`. Bảng bucket yêu cầu `quizType` notNull nên ghi sentinel `quizType = 'reading-question'`; `optionCount = 4` là **giá trị thật** (khác reading passage phải ghi `0` vì bài đọc không có khái niệm đáp án).

Mỗi câu là một lần gọi LLM riêng nên job ghi **N dòng** `english_cron_job_model_attempts` (`attemptOrder` 1..N), không gộp làm một — nhờ vậy `/english/cron/usage` biết được type nào tốn token và type nào hay hỏng. `english_cron_job_buckets` giữ **tổng** token/cost của cả bộ.

Error phase riêng: `scan_passages`, `reading_question_count`, `insert_reading_questions`.

## Chọn model

Dùng chung context `'reading'` (`ModelContext` ở `aiClient.config.ts`) với reading passage — cùng domain, cùng pool model. Model dùng được = `isActive && readingEnabled`.

Không tách context riêng vì sẽ kéo theo cột `readingQuestionEnabled` trên `ai_models`, thêm `PROVIDER_PREF_CONTEXTS`, và một tab nữa trong form AI Model ở dashboard — không đáng.

## Endpoints

### Admin — `/admin/reading-questions/*`, yêu cầu session admin

| Method   | Path                                | Ghi chú                                                                                                                       |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/admin/reading-questions`          | List + filter (`passageId`, `cefrLevel`, `topicId`, `quizType`, `model`, `isActive`, `q`, `sort`, `page`, `pageSize`)         |
| `GET`    | `/admin/reading-questions/models`   | Model đang có câu trong kho + số lượng                                                                                        |
| `GET`    | `/admin/reading-questions/buckets`  | Preview bài sẽ sinh, dùng chung hàm plan với endpoint refill nên số liệu không lệch                                           |
| `POST`   | `/admin/reading-questions/generate` | Sinh thử trọn bộ cho 1 bài, **KHÔNG lưu**. Batch bị reject → 400                                                              |
| `POST`   | `/admin/reading-questions/refill`   | Trigger sinh hàng loạt → `{ runId, totalBuckets }`, theo dõi qua `GET /english/cron/runs/:runId`                              |
| `GET`    | `/admin/reading-questions/:id`      | Chi tiết                                                                                                                      |
| `PATCH`  | `/admin/reading-questions/:id`      | Sửa `question`/`options`/`correctAnswer`/`explanation`/`isActive`. Sửa `options` thì `correctAnswer` validate theo bộ **mới** |
| `DELETE` | `/admin/reading-questions/:id`      | Xoá hẳn. Muốn giữ thì `PATCH { isActive: false }`                                                                             |

Tắt hoặc xoá câu làm bài trở thành "thiếu câu" và sẽ được cron sinh bù.

### Tenant — `/english/readings/*`, yêu cầu tenant API key

| Method | Path                      | Ghi chú                                                                               |
| ------ | ------------------------- | -------------------------------------------------------------------------------------- |
| `GET`  | `/english/readings/pop`   | 1 bài random kèm trọn bộ câu hỏi. Không destructive. Có fallback nới bucket, xem dưới |
| `GET`  | `/english/readings/count` | Số bài đã sẵn sàng theo `cefrLevel` / `topicId`                                        |

Chỉ trả bài đã **đủ** `questionsPerPassage` câu active — bài nửa vời không bao giờ được phục vụ.

**Fallback khi đúng bucket không có bài:** `/pop` không trả 404 ngay khi thiếu bài đúng `topicId` + `cefrLevel` yêu cầu, mà nới dần điều kiện (mỗi bước vẫn tôn trọng allow-list topic của tenant):

1. Đúng bucket: `topicId` + `cefrLevel` như request.
2. Nếu request có truyền `topicId` mà (1) rỗng: bỏ ràng buộc `topicId`, giữ `cefrLevel` → topic khác cùng level.
3. Nếu request có truyền `cefrLevel` mà (2) (hoặc (1) nếu không có `topicId`) vẫn rỗng: bỏ luôn `cefrLevel` → bài bất kỳ trong phạm vi tenant được phép.
4. Nếu request có truyền `excludeIds` mà (3) vẫn rỗng (pool sẵn sàng nhỏ hơn số id client đã loại): bỏ luôn `excludeIds` — chấp nhận trả lại bài đã thấy còn hơn báo lỗi.

Chỉ thật sự 404 khi cả 3 bước trên đều rỗng (tenant không còn bài đọc nào sẵn sàng).

**Lưu ý bảo mật:** bài đọc luôn gắn topic (không có bucket no-topic như question pool), nên "không truyền `topicId`" nghĩa là _mọi topic_. `assertTopicAllowed(tenant, null)` một mình **không đủ** để chặn — service nhận thêm `allowedTopicIds` và bó truy vấn theo allow-list của tenant. Tenant không được cấp topic nào thì `/pop` trả 404 và `/count` trả 0.

## Verify nhanh

```bash
# Sinh thử, không lưu
curl -s -X POST localhost:3399/admin/reading-questions/generate \
  -H 'Content-Type: application/json' -H 'Cookie: <admin session>' \
  -d '{"passageId": 4}' | jq

# Preview rồi chạy — plannedPassages phải khớp totalBuckets
curl -s 'localhost:3399/admin/reading-questions/buckets?mode=deficient' -H 'Cookie: ...' | jq '.data.summary'
curl -s -X POST localhost:3399/admin/reading-questions/refill \
  -H 'Content-Type: application/json' -H 'Cookie: ...' -d '{"mode":"deficient"}' | jq

# Bot lấy bài
curl -s 'localhost:3399/english/readings/pop?cefrLevel=A1' -H 'Authorization: Bearer eqk_...' | jq
```

Kiểm tay trên output `generate`: đúng số câu; mỗi câu 4 option không trùng; `correctAnswer` hợp lệ và **không phải lúc nào cũng 0**; `quizType` nằm trong allow-list của level; có ≥2 type khác nhau; explanation tiếng Việt trỏ đúng đoạn; **không câu nào nhắc "paragraph N"**.

Chạy refill lần 2 ngay sau đó → mọi bài phải `skipped`, không tốn token.
