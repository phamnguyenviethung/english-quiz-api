# Reading Passage

Bài đọc ngắn (~10 phút) sinh bằng LLM từ input `topicName` + `cefrLevel`, lưu vào kho để dùng lại.

> **Đừng nhầm với `quizType = 'reading'`.** Loại quiz đó (`prompt/reading-prompt.ts`, `POST /english/generate-reading`) là **quiz đọc hiểu + mental math**, nằm trong question pool. Reading passage ở đây là **nội dung thuần, chưa có câu hỏi**, nằm ở bảng riêng và pipeline riêng. Hai feature độc lập.

Nguồn quy tắc nội dung: [`reading-prompt-guideline.md`](./reading-prompt-guideline.md). Sửa guideline thì sửa `prompt/reading-passage-prompt.ts` theo.

## Phạm vi hiện tại

- Chỉ sinh **bài đọc**. Sinh câu hỏi từ bài đọc là pipeline riêng, chưa làm (đúng mục 10 của guideline).
- API **chỉ admin** (`/admin/readings/*`). Chưa expose cho tenant/bot.

## Mô hình dữ liệu

Bảng `english_reading_passages`:

| Cột                            | Ghi chú                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `title`                        | Tiêu đề ngắn do model đặt                                            |
| `paragraphs`                   | `jsonb` mảng đoạn văn theo đúng thứ tự đọc                           |
| `wordCount`                    | **Đếm lại server-side** từ `paragraphs`, không tin số model trả về   |
| `cefrLevel`                    | A1/A2/B1/B2 (dùng chung `ENG_LEVELS`)                                |
| `topicId` / `topicName`        | FK topic + snapshot tên lúc sinh (chính là input của prompt)         |
| `model`, `tokenIn`, `tokenOut` | Truy vết chi phí                                                     |
| `isActive`                     | Tắt bài kém mà không xoá. Bài đã tắt **không** tính vào bucket count |

**Bucket = `(cefrLevel, topicId)`** — 2 chiều, khác question pool (3 chiều, có thêm `quizType`). `bucketKey` dạng `"B1:7"`.

Reading luôn gắn với 1 topic (prompt cần `topicName` để khoá chủ đề) — không có bucket "no topic".

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

Tracking dùng chung bảng `english_cron_job_*`. Bảng bucket yêu cầu `quizType`/`optionCount` notNull nên reading ghi sentinel `quizType = 'reading-passage'`, `optionCount = 0` — đủ để phân biệt khi đọc lịch sử cron mà không phải đổi schema.

Error phase riêng: `reading_count`, `insert_readings`.

## Chọn model

Context `'reading'` (`ModelContext` ở `aiClient.config.ts`). Model dùng được = `isActive && readingEnabled`. Cả cron lẫn manual đều dùng context này — reading vốn đã là pool model tách biệt nên không tách schedule/manual.

Provider routing của context reading lưu **normalize** ở 2 bảng riêng, xem [`ai-model-provider.md`](./ai-model-provider.md).

## Endpoints

Toàn bộ dưới `/admin/readings`, yêu cầu session admin.

| Method   | Path                       | Ghi chú                                                                                                                                                                      |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/admin/readings`          | List + filter (`cefrLevel`, `topicId`, `withoutTopic`, `model`, `isActive`, `q`, `createdFrom/To`, `sort`, `page`, `pageSize`). `q` ILIKE trên title + nội dung đoạn + model |
| `GET`    | `/admin/readings/models`   | Model đang có bài trong kho + số lượng (đổ dropdown filter)                                                                                                                  |
| `GET`    | `/admin/readings/buckets`  | Preview bucket sẽ sinh, dùng chung hàm plan với endpoint refill nên số liệu không lệch                                                                                       |
| `POST`   | `/admin/readings/generate` | Sinh thử 1 bài, **KHÔNG lưu**. Model trả bài không hợp lệ → 400                                                                                                              |
| `POST`   | `/admin/readings/refill`   | Trigger sinh hàng loạt → `{ runId, totalBuckets }`, theo dõi qua `GET /english/cron/runs/:runId`                                                                             |
| `GET`    | `/admin/readings/:id`      | Chi tiết                                                                                                                                                                     |
| `PATCH`  | `/admin/readings/:id`      | Sửa `title`/`paragraphs`/`isActive`. Sửa `paragraphs` tự tính lại `wordCount`                                                                                                |
| `DELETE` | `/admin/readings/:id`      | Xoá hẳn. Muốn giữ lại thì `PATCH { isActive: false }`                                                                                                                        |

## Dashboard

- `/readings` — kho bài, filter + phân trang, mở sheet chi tiết để đọc/sửa/tắt/xoá
- `/readings/refill` — chọn model + phạm vi + lọc bucket, xem preview số bài sẽ sinh rồi chạy
- Nút "Tạo thử 1 bài" mở dialog gọi `/admin/readings/generate` (không lưu)
- Bật/tắt model cho reading + provider routing: tab "Bài đọc" trong form AI Model
