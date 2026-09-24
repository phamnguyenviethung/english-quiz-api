# Beginner — nội dung cho người mới học

Luồng nội dung riêng cho người mới học tiếng Anh, chạy song song với luồng thường trong cùng các bảng (question pool, reading passage, reading question). Nội dung beginner:

- Độ khó **tối đa B1** (CEFR) — chỉ level `A1`, `A2`, `B1`.
- **Tối đa 4 đáp án** — bucket beginner luôn `optionCount = 4` (luồng thường B1/B2 là 5).
- Từ vựng **thông dụng hằng ngày**, bám wordlist Cambridge (Starters / Movers / Flyers, A2 Key, B1 Preliminary) và sách giáo khoa Cambridge.
- Sinh bằng **prompt beginner** dựng chồng lên prompt gốc của từng loại câu (xem [Prompt](#prompt)).

Hằng số nằm ở `src/core/services/english/questionTypes.ts`: `BEGINNER_ENG_LEVELS`, `BEGINNER_MAX_OPTION_COUNT`, `BEGINNER_READING_PASSAGE_TYPE`, `isBeginnerLevel()`.

## Bất biến

**Nội dung beginner và nội dung thường không bao giờ trộn.** Mọi truy vấn đếm / pop / refill đều lọc theo `forBeginner`:

- Tenant không truyền `beginner` (hoặc `beginner=false`) → chỉ nhận nội dung thường.
- Tenant truyền `beginner=true` → chỉ nhận nội dung beginner.
- Bucket beginner có key riêng (hậu tố `:beginner`), tồn kho và trần `maxPerBucket` tính riêng.

## Bật beginner ở đâu

| Đối tượng | Cách bật                                                                          | Ý nghĩa                                                                                        |
| --------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Topic     | `english_topics.forBeginner` — `POST/PATCH /english/topics`                       | Topic có bucket beginner (pool + reading). Mặc định `false`.                                   |
| Quiz type | Config `beginner_quiz_types.items` (xem [english-config.md](./english-config.md)) | Loại câu được sinh/phục vụ cho beginner. Mặc định tắt `slang`, `idiom`.                        |
| Câu pool  | `english_question_pool.forBeginner` — `PATCH /admin/pool/questions/:id`           | Câu thuộc bucket beginner. Cron tự set khi sinh bucket beginner.                               |
| Bài đọc   | `english_reading_passages.forBeginner` — `PATCH /admin/readings/:id`              | Bài thuộc bucket beginner. Câu hỏi của bài (`english_reading_questions.forBeginner`) đổi theo. |

Loại câu beginner hiệu lực = bật ở `beginner_quiz_types` **và** đang bật (weight > 0) ở `quiz_distribution` — `quiz_distribution` là kill switch chung cho mọi luồng (`getBeginnerQuizTypes()` ở `questionPool.service.ts`).

Đánh dấu thủ công bị từ chối (400) khi: câu/bài level `B2`; câu pool có hơn 4 đáp án; câu pool thuộc loại chưa bật cho beginner; bài đọc type `academic`. Bỏ đánh dấu (`false`) luôn được phép.

Tắt cờ beginner của topic chỉ dừng sinh bucket beginner mới (scan bỏ qua, job đang chờ tự skip) — câu/bài beginner đã có giữ nguyên.

## Bucket

**Question pool** — `scanBuckets` (`poolRefill.service.ts`) quét thêm một vòng beginner:

```
topic (isActive && forBeginner) × BEGINNER_ENG_LEVELS × getBeginnerQuizTypes()   → optionCount = 4
bucketKey = `${engLevel}:${topicId}:${quizType}:beginner`
```

**Reading passage** — `scanReadingBuckets` (`readingRefill.service.ts`):

```
topic (isActive && forBeginner) × BEGINNER_ENG_LEVELS × ['daily']
bucketKey = `${cefrLevel}:${topicId}:daily:beginner`
```

Bucket thường giữ nguyên format key cũ nên lịch sử refill (`english_cron_job_buckets`) không đổi. Bucket key luôn đi qua `bucketKeyOf()` / `readingBucketKeyOf()`, không tự ghép chuỗi.

Cron (pool refill, reading refill, sibling gen) và manual refill tự bao gồm bucket beginner. Admin lọc bằng `audience`:

- `audience=beginner` → chỉ bucket beginner
- `audience=standard` → chỉ bucket thường
- bỏ trống → cả hai

Job data (`QuestionGenJobData`, `ReadingGenJobData`) mang `forBeginner`; job cũ trong queue không có field này được coi là bucket thường. `fillBucketDetailed` / `fillReadingBucketDetailed` skip bucket beginner nếu topic đã tắt cờ, level là B2, hoặc (reading) type khác `daily`.

## Prompt

File: `src/core/services/english/prompt/beginner-prompt.ts`. Không viết lại prompt riêng cho từng loại câu — prompt beginner là **prompt gốc + khối BEGINNER MODE append cuối**, cùng pattern với khối EXPERT LEARNER MODE hiện có.

- `study.service.ts` `buildLevelInstruction(ctx, quizType)`: `ctx.forBeginner` → `buildBeginnerInstruction` thay cho `buildDifficultyInstruction` (EXPERT LEARNER MODE — MAXIMUM DIFFICULTY).
- Khối BEGINNER MODE được quyền override mọi rule đẩy độ khó phía trên: trần B1 (B2 bị clamp về B1), từ vựng wordlist/SGK Cambridge, câu ngắn ngữ pháp đơn giản, distractor khác nghĩa rõ ràng (không near-synonym), đúng `min(optionCount, 4) - 1` distractor, explanation tiếng Việt dễ hiểu.
- Override theo loại câu (`BEGINNER_TYPE_OVERRIDES`): vocab / fillblank / synonym bỏ `DOMAIN A–G` và danh sách "overused quiz words", chọn từ trong `BEGINNER_VOCAB_DOMAINS`; odd-one-out dùng category cơ bản; phrase / verb-use-match dùng collocation SGK; conversation / description / paragraph / idiom / slang có hướng dẫn riêng.
- `paragraph` ở luồng thường không append level instruction (giữ nguyên hành vi cũ); luồng beginner có append BEGINNER MODE.
- Reading passage: `buildReadingPassagePrompt({ forBeginner })` thay khối LEVEL bằng `buildBeginnerReadingLevelBlock` (giữ nguyên word band và validator).
- Reading question: `buildReadingQuestionPrompt({ forBeginner })` thay `buildLevelSection` bằng `buildBeginnerReadingQuestionLevelSection`. Vẫn 4 đáp án (`OPTIONS_PER_QUESTION`).
- Sibling và AI review: `describeLearnerLevel(ctx)` (`review-prompt.ts`) dùng `BEGINNER_LEVEL_NOTE` khi câu gốc là beginner; review còn gắn cờ `levelMismatch` với từ khó / distractor near-synonym. Sibling của câu beginner cũng là câu beginner (cùng bucket).

## Endpoints

**Tenant** (`/english/*`, query `beginner` (`true` / `false`), mặc định false):

| Endpoint                                       | Hành vi khi `beginner=true`                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /english/quiz-types`                      | Chỉ loại câu beginner.                                                                          |
| `GET /english/topics`, `/topics/random-pairs`  | Chỉ topic `forBeginner` (vẫn lọc allow-list tenant).                                            |
| `GET /english/pool/pop`                        | Chỉ câu beginner, quizType giao allow-list tenant với loại beginner. `engLevel=B2` → 400.       |
| `GET /english/pool/count`                      | Đếm bucket beginner. `engLevel=B2` → 400. Response có `forBeginner`.                            |
| `GET /english/pool/pick-quiz-type`             | Bốc trong loại beginner. Không loại nào bật → 400.                                              |
| `GET /english/pool/questions`                  | Filter `forBeginner` (`true` / `false`, bỏ trống = cả hai).                                     |
| `GET /english/readings/pop`, `/readings/count` | Chỉ bài beginner — hard filter xuyên suốt fallback. `cefrLevel=B2` hoặc `type=academic` → 400.  |
| `POST /english/generate/:quizType`             | Body `forBeginner: true` → prompt beginner. Level B2, `optionCount=5` hoặc loại chưa bật → 400. |

**Admin:**

- `POST /english/topics` — body thêm `forBeginner`.
- `PATCH /english/topics/:id` — `{ displayName?, description?, isActive?, forBeginner? }`.
- `PATCH /admin/pool/questions/:id` — `{ forBeginner }`.
- `GET /admin/pool/buckets`, `POST /admin/pool/refill`, `GET /admin/pool/siblings/buckets`, `POST /admin/pool/siblings/refill`, `GET /admin/readings/buckets`, `POST /admin/readings/refill` — filter `audience`; bucket preview có `forBeginner`.
- `GET /admin/readings`, `GET /admin/reading-questions` — filter `forBeginner`.
- `PATCH /admin/readings/:id` — body thêm `forBeginner`.
- `POST /admin/readings/generate` — body thêm `forBeginner` (sinh thử bằng prompt beginner).

## Tests

- `test/unit/beginner-prompt.test.ts` — khối BEGINNER MODE, trần B1, tối đa 4 đáp án, override theo loại, config, bucket key.
- `test/integration/beginner-pool.test.ts` — không gian bucket, sinh, phục vụ, đánh dấu thủ công, sibling kế thừa cờ.
- `test/integration/beginner-reading.test.ts` — bucket bài đọc, sinh, phục vụ, đánh dấu bài.
- `test/e2e/j9-beginner.test.ts` — journey admin bật topic → bot phục vụ người mới học.
