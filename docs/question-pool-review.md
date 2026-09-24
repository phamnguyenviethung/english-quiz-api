# Question Pool — AI Review

Vòng **AI review + admin approve** cho từng câu trong `english_question_pool`. Câu trong pool được sinh tự động và đi thẳng vào production (client `pop` dùng ngay). Feature này cho admin gọi LLM rà soát + sửa một/nhiều câu, lưu kết quả chờ duyệt, rồi quyết định có ghi đè `questionData` bằng bản sửa hay không.

## Luồng

1. Admin chọn pool id → `POST /admin/pool/reviews { poolQuestionIds, model?, adminNote? }`.
2. Với mỗi câu (fire-and-forget, bounded concurrency 3):
   - Load item (`questionPoolService.getPoolQuestionById`), parse `questionData`.
   - Resolve model review theo context **`manual`** (`resolveStudyModel('manual', model?)`).
   - Dựng learner view: **`buildLearnerView(quizType, data)`** (`prompt/review-type-spec.ts`) — dựng "màn hình người làm bài": đề + list options **đã xáo trộn** (seeded, đáp án KHÔNG cố định ở A) và **KHÔNG lộ đâu là đáp án**. Trả kèm `layout` (map letter → option gốc).
   - Dựng answer key: **`buildAnswerKey(quizType, data, layout)`** — khối `ĐÁP ÁN & GIẢI THÍCH` dạng người đọc (đáp án đúng theo letter đã trộn + explanation + "vì sao X sai" + bản dịch + ví dụ + metadata). Giải thích/bản dịch distractor ánh xạ theo letter đã trộn.
   - Dựng prompt review: **`buildReviewPrompt(quizType, ctx, { adminNote })`** (`src/core/services/english/prompt/review-prompt.ts`) — **KHÔNG** nhồi prompt sinh câu hỏi. Gồm: level note (chỉ mô tả A1–B2, không "EXPERT MODE"; câu `forBeginner` dùng `BEGINNER_LEVEL_NOTE` và `levelMismatch` gắn cờ thêm từ khó / distractor near-synonym — xem [`beginner.md`](./beginner.md)) + **`QUIZ_TYPE_REVIEW_SPEC[quizType]`** (giờ là **văn xuôi ngắn** mô tả loại quiz cho người review, không phải liệt kê field JSON) + **quy trình 3 bước**: STEP 1 tự giải khi chưa thấy đáp án (chốt 1 letter + confidence) → STEP 2 đối chiếu letter với đáp án gán (`solvedAnswerMismatch`) → STEP 3 checklist 13 mục + luật FORMAT + **EDIT DISCIPLINE** (chỉ sửa chỗ hỏng, câu tốt trả `pass` + `revisedData` byte-identical) + **ANTI-SHALLOW** (mỗi cờ true phải có `issues[]` trích nguyên văn đoạn lỗi; cấm nhận xét chung chung; `issues` rỗng ⟺ mọi cờ false) + `adminNote` block (nếu có).
   - `input` = learner view + `\n\n` + answer key + `\n\n=== RAW JSON (chỉ để biết shape trả revisedData) ===\n` + `JSON.stringify(original)`.
   - `generateStructuredOutput(PoolReviewResultSchema, ..., maxOutputTokens: 6000)` → `{ verdict, summary, score, selfSolve, checklist, issues, revisedData }`. `selfSolve = { pickedLetter, confidence, reasoning }` được ghép làm tiền tố `summary` ("AI tự giải: X (confidence). …"), không lưu cột riêng.
   - Validate `revisedData` theo schema đúng `quizType` (`QUESTION_SCHEMA_BY_TYPE`, lấy từ `study.service.ts`) → set `checklist.formatValid`.
   - Tính `changedFields` = diff top-level key giữa original và revised (`_.isEqual`).
   - Ghi 1 row `english_question_pool_reviews` (`status='pending'`). Lỗi LLM/parse → row `status='failed'` + `errorMessage`, batch vẫn chạy tiếp.
3. Admin xem list/detail, rồi:
   - **Approve** (`POST /admin/pool/reviews/:id/approve { data? }`): ghi đè `english_question_pool.questionData` bằng `data` (bản admin tự chỉnh) hoặc `revisedData`; validate lại theo schema `quizType`; set `english_question_pool.updatedAt`; review `status='approved'` + `resolvedByUserId`/`resolvedAt`.
   - **Reject** (`POST /admin/pool/reviews/:id/reject { note? }`): review `status='rejected'`, **không đụng** pool item.
   - **Delete** (`DELETE /admin/pool/reviews/:id`): xoá row review (dọn rác).

Chỉ review `pending` mới approve/reject được. `POST /admin/pool/reviews` bỏ qua (`skipped`) câu đang có review `pending` hoặc đang chạy (guard `activeReviewIds` — module state trong `questionPoolReview.service.ts`).

## Bảng `english_question_pool_reviews`

| Cột                                                               | Kiểu                                | Ghi chú                                                                    |
| ----------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `id`                                                              | serial PK                           |                                                                            |
| `poolQuestionRefId`                                               | int FK → `english_question_pool.id` | `onDelete: cascade`                                                        |
| `quizType` / `engLevel` / `optionCount` / `topicId` / `topicName` | snapshot                            | copy từ pool item lúc review, list/filter khỏi join                        |
| `adminNote`                                                       | text                                | Ghi chú admin gửi kèm khi request review (nullable) — hiện lại ở detail    |
| `originalData`                                                    | text                                | JSON string snapshot `questionData` lúc review                             |
| `revisedData`                                                     | text                                | JSON string bản sửa (`''` khi `failed`)                                    |
| `verdict`                                                         | text                                | `pass` \| `revised` \| `reject` — kết luận AI về bản gốc (null khi failed) |
| `summary`                                                         | text                                | 1-3 câu tiếng Việt, có tiền tố "AI tự giải: X (confidence)."               |
| `score`                                                           | int                                 | 0-100, chất lượng bản gốc                                                  |
| `checklist`                                                       | jsonb `PoolReviewChecklist`         | 14 cờ AI trả (true = có vấn đề trong bản gốc) + `formatValid` (server set) |
| `issues`                                                          | jsonb `PoolReviewIssue[]`           | `{ field, severity, problem, fix }`                                        |
| `changedFields`                                                   | jsonb `string[]`                    | top-level field thực sự đổi (authoritative, type-agnostic)                 |
| `status`                                                          | text                                | `pending` \| `approved` \| `rejected` \| `failed` — hành động admin        |
| `errorMessage`                                                    | text                                | khi `failed`                                                               |
| `reviewModel` / `tokenIn` / `tokenOut`                            |                                     | model + token của lần review                                               |
| `resolvedByUserId` / `resolvedAt`                                 |                                     | Better Auth user id (text, không FK), set khi approve/reject               |
| `createdAt` / `updatedAt`                                         | timestamp                           |                                                                            |

`checklist` (15 cờ, true = có vấn đề trừ `formatValid` true = tốt): `notSolvable`, `insufficientContext`, `multipleDefensibleAnswers`, `answerIncorrect`, `optionsFormInconsistent` (options lệch loại từ / độ dài / dạng ngữ pháp / ngôn ngữ, hoặc không điền được vào chỗ trống — vd blank cần cụm 3 chữ nhưng options 1 chữ), `requiresOutsideKnowledge` (cần dữ kiện ngoài câu / vượt level), `solvedAnswerMismatch` (đáp án AI tự giải ra khác đáp án gán), `explanationMismatch`, `explanationDoesNotDeriveAnswer` (theo đề + `explanation` vẫn không dẫn tới đúng option gán), `distractorExplanationMismatch`, `translationMismatch`, `spellingOrGrammarError`, `offTopic`, `levelMismatch`, `formatValid`.

## Endpoints (`Admin / Pool Review`, session admin)

| Method   | Path                              | Mô tả                                                                                                                                                                                                                     |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/admin/pool/reviews`             | body `{ poolQuestionIds: number[] (1..30), model?, adminNote? (≤1000) }` → `{ accepted, skipped }`. Fire-and-forget. `model` = OpenRouter id trong pool `manualEnabled`; `adminNote` chèn vào prompt làm hướng soi riêng. |
| `GET`    | `/admin/pool/reviews`             | filter `status`/`verdict`/`quizType`/`engLevel`/`topicId`/`poolQuestionRefId`/`q`/`sort`/`page`/`pageSize`. Không kèm original/revisedData.                                                                               |
| `GET`    | `/admin/pool/reviews/:id`         | detail: `originalData`/`revisedData` + bản đã parse + `diff[]` từng field.                                                                                                                                                |
| `POST`   | `/admin/pool/reviews/:id/approve` | body `{ data? }`. Ghi đè pool item, review → `approved`.                                                                                                                                                                  |
| `POST`   | `/admin/pool/reviews/:id/reject`  | body `{ note? }`. Review → `rejected`, pool item giữ nguyên.                                                                                                                                                              |
| `DELETE` | `/admin/pool/reviews/:id`         | Xoá row review.                                                                                                                                                                                                           |

## Giới hạn / lưu ý

- Chỉ 11 quizType của `english_question_pool` được hỗ trợ; `reading` và reading-* không nằm trong pool nên `POST /admin/pool/reviews` với câu loại đó sẽ ghi row `failed`.
- Model review chạy context `manual` — bật/tắt qua `manualEnabled` ở `ai_models`, provider routing theo `manualProvider`.
- Cap 30 câu/lần (`POOL_REVIEW_BATCH_MAX`). Không qua BullMQ, không có run-tracking như pool refill — theo dõi bằng cách poll `GET /admin/pool/reviews?status=pending`.
- Prompt/Zod question schema vẫn ở code (`prompt/*-prompt.ts`, `study.service.ts`) — xem `generate-question-common-rule.md`.
