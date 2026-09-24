# Reading Passage

Bài đọc ngắn (~10 phút) sinh bằng LLM từ input `topicName` + `cefrLevel` + `type`, lưu vào kho để dùng lại.

> **Đừng nhầm với `quizType = 'reading'`.** Loại quiz đó (`prompt/reading-prompt.ts`, `POST /english/generate-reading`) là **quiz đọc hiểu + mental math**, nằm trong question pool. Reading passage ở đây là **nội dung thuần, chưa có câu hỏi**, nằm ở bảng riêng và pipeline riêng. Hai feature độc lập.

`type` (`READING_PASSAGE_TYPES` ở `questionTypes.ts`) có 2 giá trị:

- `daily` (**mặc định**) — narrative, "micro-reading" đời thường. Prompt: `prompt/reading-passage-prompt.ts`.
- `academic` — expository/informational, văn phong trang trọng, khuyến khích từ vựng học thuật. Prompt: `prompt/reading-passage-prompt-academic.ts` — bản duplicate-và-sửa của prompt daily.

Nguồn quy tắc nội dung: [`reading-prompt-guideline.md`](./reading-prompt-guideline.md). Sửa guideline (daily hoặc academic) thì sửa file prompt tương ứng theo.

## Phạm vi hiện tại

- File này chỉ nói về **bài đọc**. Sinh câu hỏi từ bài đọc là pipeline riêng — xem [`reading-question.md`](./reading-question.md).
- API quản trị bài đọc **chỉ admin** (`/admin/readings/*`). Bot lấy bài kèm câu hỏi qua `/english/readings/pop` (thuộc pipeline reading question).

## Mô hình dữ liệu

Bảng `english_reading_passages`:

| Cột                            | Ghi chú                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `title`                        | Tiêu đề ngắn do model đặt                                                                                      |
| `paragraphs`                   | `jsonb` mảng đoạn văn theo đúng thứ tự đọc                                                                     |
| `wordCount`                    | **Đếm lại server-side** từ `paragraphs`, không tin số model trả về                                             |
| `cefrLevel`                    | A1/A2/B1/B2 (dùng chung `ENG_LEVELS`)                                                                          |
| `topicId` / `topicName`        | FK topic + snapshot tên lúc sinh (chính là input của prompt)                                                   |
| `type`                         | `daily` (mặc định) / `academic` — xem `READING_PASSAGE_TYPES`. Chỉ set lúc sinh, không sửa qua PATCH           |
| `model`, `tokenIn`, `tokenOut` | Truy vết chi phí                                                                                               |
| `isActive`                     | Tắt bài kém mà không xoá. Bài đã tắt **không** tính vào bucket count                                           |
| `forBeginner`                  | Bài beginner (≤ B1, chỉ `daily`, prompt beginner) — chiều thứ 4 của bucket. Xem [`beginner.md`](./beginner.md) |

**Bucket = `(cefrLevel, topicId, type)`** — 3 chiều. `bucketKey` dạng `"B1:7:daily"`. Cron auto-refill quét cả 2 type trong cùng lịch (`reading-refill-daily`) nên khối lượng sinh mỗi lần chạy tăng gấp đôi so với trước khi có `type`.

Reading luôn gắn với 1 topic (prompt cần `topicName` để khoá chủ đề) — không có bucket "no topic".

Bucket beginner: topic bật `forBeginner` × A1–B1 × chỉ `daily`, key `"A2:7:daily:beginner"` (luôn qua `readingBucketKeyOf()`). Prompt dùng `buildBeginnerReadingLevelBlock` thay khối LEVEL; word band giữ nguyên. `PATCH /admin/readings/:id { forBeginner }` đổi cờ bài (chỉ bài A1–B1, `daily`) và cờ mọi câu hỏi của bài trong cùng transaction.

## Độ dài

Guideline mục 2 dùng **một band chung 150–220 từ cho mọi CEFR level** — level thể hiện qua từ vựng + độ phức tạp câu, không qua độ dài. Khai ở `READING_WORD_BAND` (`prompt/reading-passage-prompt.ts`).

Sau khi model trả về, `study.service.generateReadingPassageBatch`:

1. Chuẩn hoá khoảng trắng, bỏ đoạn rỗng
2. **Đếm lại** `wordCount` và ghi đè giá trị model đưa ra
3. Ép `cefrLevel` / `topic` về đúng input
4. Loại bài ngoài `READING_WORD_ACCEPT` (**140–235**), bài dưới 2 đoạn, bài trùng title trong `excludeTitles`

Ngưỡng accept rộng hơn band mục tiêu vì cách đếm từ của model không khớp tuyệt đối với `countPassageWords` (split whitespace); loại quá gắt thì hỏng batch mà chất lượng không hơn.

Prompt có bước self-check bắt model tự đếm và cắt/bù trước khi xuất JSON — không có bước này model hay vượt band.

Dashboard hiển thị badge số từ, tô cam khi lệch band (`READING_WORD_BAND` ở `features/readings/constants.ts` phải khớp backend). Bài sinh trước khi đổi band (70–190 từ) sẽ hiện lệch band — đúng như mong đợi, không phải bug.

## Chống lặp nội dung

Guideline mục 9 coi "variety" là yêu cầu cứng. Trước mỗi lần sinh, job lấy `reading_passage.excludeRecentTitleCount` title gần nhất **cùng bucket** đưa vào prompt dưới mục "ALREADY USED". `temperature` để 0.95, cao hơn các quizType khác.

## Config

Namespace `reading_passage` (category `reading` trong UI cấu hình):

| Key                                                | Mặc định   | Ý nghĩa                                       |
| -------------------------------------------------- | ---------- | --------------------------------------------- |
| `maxPerBucket`                                     | 3          | Số bài mục tiêu mỗi bucket                    |
| `refillThresholdRatio`                             | 0.5        | Ngưỡng coi là "thiếu" theo tỉ lệ              |
| `perBucketGenerationCap`                           | 3          | Trần số bài sinh mỗi lượt chạm bucket         |
| `manualFillMinCount` / `MaxCount` / `DefaultCount` | 1 / 10 / 2 | Biên số bài khi admin trigger                 |
| `manualFillConcurrency`                            | 2          | Số bucket chạy song song khi manual           |
| `excludeRecentTitleCount`                          | 15         | Số title gần nhất đưa vào prompt để tránh lặp |

`job_flags`: `readingRefillEnabled` (bật/tắt cron), `readingRefillMaxPerRun` (mặc định 20 — trần tổng số bài mỗi lần cron chạy).

`reading_refill_schedule.items`: danh sách cron, mặc định `[{ name: 'reading-refill-daily', cron: '0 6 * * *' }]`. Đổi giá trị này sẽ reconcile BullMQ job scheduler **ngay lập tức**, không cần restart.

## Jobs

Hai đường, cùng dùng `fillReadingBucketDetailed` (`core/cron/reading-gen.job.ts`):

**Cron (`jobKey = reading_refill`)** — parent queue `english-reading-refill` scan bucket thiếu → tạo BullMQ flow, mỗi bucket là 1 child ở `english-reading-refill-child` (concurrency 2). Chịu trần `readingRefillMaxPerRun`.

**Manual (`jobKey = reading_manual_fill`)** — `POST /admin/readings/refill`, chạy in-process với bounded concurrency, **bỏ qua** trần per-run vì đây là hành động admin chủ động.

Thứ tự quét bucket (`scanReadingBuckets`) giống question pool: `deficiency` giảm dần → lần fill thành công gần nhất tăng dần (null trước) → `bucketKey`. Tiêu chí thứ 2 là phần chống đói khi một lần chạy bị cắt giữa chừng vì trần chi phí.

Tracking dùng chung bảng `english_cron_job_*`. Bảng bucket yêu cầu `quizType`/`optionCount` notNull nên reading ghi sentinel `quizType = 'reading-passage-{type}'` (`reading-passage-daily` / `reading-passage-academic`), `optionCount = 0` — đủ để phân biệt khi đọc lịch sử cron mà không phải đổi schema.

Error phase riêng: `reading_count`, `insert_readings`.

## Chọn model

Context `'reading'` (`ModelContext` ở `aiClient.config.ts`). Model dùng được = `isActive && readingEnabled`. Cả cron lẫn manual đều dùng context này — reading vốn đã là pool model tách biệt nên không tách schedule/manual.

Provider routing của context reading lưu **normalize** ở 2 bảng riêng, xem [`ai-model-provider.md`](./ai-model-provider.md).

## Endpoints

Toàn bộ dưới `/admin/readings`, yêu cầu session admin.

| Method   | Path                       | Ghi chú                                                                                                                                                                              |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/admin/readings`          | List + filter (`cefrLevel`, `topicId`, `withoutTopic`, `type`, `model`, `isActive`, `q`, `createdFrom/To`, `sort`, `page`, `pageSize`). `q` ILIKE trên title + nội dung đoạn + model |
| `GET`    | `/admin/readings/models`   | Model đang có bài trong kho + số lượng (đổ dropdown filter)                                                                                                                          |
| `GET`    | `/admin/readings/buckets`  | Preview bucket sẽ sinh (filter thêm `types`, CSV), dùng chung hàm plan với endpoint refill nên số liệu không lệch                                                                    |
| `POST`   | `/admin/readings/generate` | Sinh thử 1 bài, cần chọn `type` (`daily`/`academic`), **KHÔNG lưu**. Model trả bài không hợp lệ → 400                                                                                |
| `POST`   | `/admin/readings/refill`   | Trigger sinh hàng loạt, `filter.types` lọc theo type → `{ runId, totalBuckets }`, theo dõi qua `GET /english/cron/runs/:runId`                                                       |
| `GET`    | `/admin/readings/:id`      | Chi tiết                                                                                                                                                                             |
| `PATCH`  | `/admin/readings/:id`      | Sửa `title`/`paragraphs`/`isActive`. Sửa `paragraphs` tự tính lại `wordCount` **và tắt toàn bộ câu hỏi của bài** (xem dưới)                                                          |
| `DELETE` | `/admin/readings/:id`      | Xoá hẳn. Muốn giữ lại thì `PATCH { isActive: false }`                                                                                                                                |

## Quan hệ với câu hỏi đọc hiểu

Sửa `paragraphs` qua `PATCH /admin/readings/:id` sẽ **tắt (`isActive = false`) mọi câu hỏi** của bài trong cùng transaction, đồng thời reset `questionGenAttempts = 0`. Câu hỏi cũ neo vào evidence trong đoạn văn cũ nên đổi nội dung là làm chúng sai; tắt thay vì xoá để admin còn xem lại, và pipeline câu hỏi sẽ tự sinh lại ở lần chạy sau. Sửa mỗi `title`/`isActive` thì không đụng gì.

`DELETE /admin/readings/:id` xoá luôn câu hỏi của bài (`ON DELETE CASCADE`).

Cột `questionGenAttempts` trên bảng này thuộc pipeline câu hỏi — xem [`reading-question.md`](./reading-question.md).

## Dashboard

- `/readings` — kho bài, filter + phân trang, mở sheet chi tiết để đọc/sửa/tắt/xoá
- `/readings/refill` — chọn model + phạm vi + lọc bucket, xem preview số bài sẽ sinh rồi chạy
- Nút "Tạo thử 1 bài" mở dialog gọi `/admin/readings/generate` (không lưu)
- Bật/tắt model cho reading + provider routing: tab "Bài đọc" trong form AI Model
