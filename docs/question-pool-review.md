# Question Pool — AI Review

Vòng **AI review + admin approve** cho từng câu trong `english_question_pool`. Câu trong pool được sinh tự động và đi thẳng vào production (client `pop` dùng ngay). Feature này cho admin gọi LLM rà soát + sửa một/nhiều câu, lưu kết quả chờ duyệt, rồi quyết định có ghi đè `questionData` bằng bản sửa hay không.

## Luồng

1. Admin chọn pool id → `POST /admin/pool/reviews { poolQuestionIds, model? }`.
2. Với mỗi câu (fire-and-forget, bounded concurrency 3):
   - Load item (`questionPoolService.getPoolQuestionById`), parse `questionData`.
   - Resolve model review theo context **`manual`** (`resolveStudyModel('manual', model?)`).
   - Dựng prompt review: **`buildReviewPrompt(quizType, ctx)`** (`src/core/services/english/prompt/review-prompt.ts`) — nhúng lại đúng base prompt sinh câu hỏi của `quizType` + `buildDifficultyInstruction(engLevel, optionCount, topicName)` làm "spec", rồi yêu cầu model soi lỗi.
   - `generateStructuredOutput(PoolReviewResultSchema, ...)` → `{ verdict, summary, score, checklist, issues, revisedData }`.
   - Validate `revisedData` theo schema đúng `quizType` (`QUESTION_SCHEMA_BY_TYPE`, lấy từ `study.service.ts`) → set `checklist.formatValid`.
   - Tính `changedFields` = diff top-level key giữa original và revised (`_.isEqual`).
   - Ghi 1 row `english_question_pool_reviews` (`status='pending'`). Lỗi LLM/parse → row `status='failed'` + `errorMessage`, batch vẫn chạy tiếp.
3. Admin xem list/detail, rồi:
   - **Approve** (`POST /admin/pool/reviews/:id/approve { data? }`): ghi đè `english_question_pool.questionData` bằng `data` (bản admin tự chỉnh) hoặc `revisedData`; validate lại theo schema `quizType`; set `english_question_pool.updatedAt`; review `status='approved'` + `resolvedByUserId`/`resolvedAt`.
   - **Reject** (`POST /admin/pool/reviews/:id/reject { note? }`): review `status='rejected'`, **không đụng** pool item.
   - **Delete** (`DELETE /admin/pool/reviews/:id`): xoá row review (dọn rác).

Chỉ review `pending` mới approve/reject được. `POST /admin/pool/reviews` bỏ qua (`skipped`) câu đang có review `pending` hoặc đang chạy (guard `activeReviewIds` — module state trong `questionPoolReview.service.ts`).

## Bảng `english_question_pool_reviews`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | serial PK | |
| `poolQuestionRefId` | int FK → `english_question_pool.id` | `onDelete: cascade` |
| `quizType` / `engLevel` / `optionCount` / `topicId` / `topicName` | snapshot | copy từ pool item lúc review, list/filter khỏi join |
| `originalData` | text | JSON string snapshot `questionData` lúc review |
| `revisedData` | text | JSON string bản sửa (`''` khi `failed`) |
| `verdict` | text | `pass` \| `revised` \| `reject` — kết luận AI về bản gốc (null khi failed) |
| `summary` | text | 1-3 câu tiếng Việt |
| `score` | int | 0-100, chất lượng bản gốc |
| `checklist` | jsonb `PoolReviewChecklist` | 9 cờ AI trả + `formatValid` (server set) |
| `issues` | jsonb `PoolReviewIssue[]` | `{ field, severity, problem, fix }` |
| `changedFields` | jsonb `string[]` | top-level field thực sự đổi (authoritative, type-agnostic) |
| `status` | text | `pending` \| `approved` \| `rejected` \| `failed` — hành động admin |
| `errorMessage` | text | khi `failed` |
| `reviewModel` / `tokenIn` / `tokenOut` | | model + token của lần review |
| `resolvedByUserId` / `resolvedAt` | | Better Auth user id (text, không FK), set khi approve/reject |
| `createdAt` / `updatedAt` | timestamp | |

`checklist` (10 cờ): `questionTextChanged`, `answerChanged`, `optionsChanged`, `explanationChanged`, `exampleChanged`, `hasFactualError`, `hasGrammarError`, `topicMismatch`, `levelMismatch`, `formatValid`.

## Endpoints (`Admin / Pool Review`, session admin)

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/admin/pool/reviews` | body `{ poolQuestionIds: number[] (1..30), model? }` → `{ accepted, skipped }`. Fire-and-forget. |
| `GET` | `/admin/pool/reviews` | filter `status`/`verdict`/`quizType`/`engLevel`/`topicId`/`poolQuestionRefId`/`q`/`sort`/`page`/`pageSize`. Không kèm original/revisedData. |
| `GET` | `/admin/pool/reviews/:id` | detail: `originalData`/`revisedData` + bản đã parse + `diff[]` từng field. |
| `POST` | `/admin/pool/reviews/:id/approve` | body `{ data? }`. Ghi đè pool item, review → `approved`. |
| `POST` | `/admin/pool/reviews/:id/reject` | body `{ note? }`. Review → `rejected`, pool item giữ nguyên. |
| `DELETE` | `/admin/pool/reviews/:id` | Xoá row review. |

## Giới hạn / lưu ý

- Chỉ 11 quizType của `english_question_pool` được hỗ trợ; `reading` và reading-* không nằm trong pool nên `POST /admin/pool/reviews` với câu loại đó sẽ ghi row `failed`.
- Model review chạy context `manual` — bật/tắt qua `manualEnabled` ở `ai_models`, provider routing theo `manualProvider`.
- Cap 30 câu/lần (`POOL_REVIEW_BATCH_MAX`). Không qua BullMQ, không có run-tracking như pool refill — theo dõi bằng cách poll `GET /admin/pool/reviews?status=pending`.
- Prompt/Zod question schema vẫn ở code (`prompt/*-prompt.ts`, `study.service.ts`) — xem `generate-question-common-rule.md`.
