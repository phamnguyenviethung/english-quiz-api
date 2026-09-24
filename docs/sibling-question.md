# Question Pool — Sibling Question

Dựa vào **một câu pool gốc** để sinh ra các **câu tương tự** (sibling): kiểm tra **đúng cùng term cần học** (từ / cụm / idiom / slang…), **giữ nguyên** độ khó (CEFR) và topic, còn **ngữ cảnh / distractor / ví dụ / giải thích** thì sinh mới và khác rõ rệt.

Khác với hai feature lân cận:

- **AI Review** ([`question-pool-review.md`](./question-pool-review.md)) rà soát + **ghi đè tại chỗ** một câu qua bước admin approve. Sibling **tạo row mới** trong pool, **không có bước duyệt**.
- **Generate thường** ([`generate-question-common-rule.md`](./generate-question-common-rule.md)) sinh câu từ số 0. Sibling **khóa nguyên văn** term + độ khó + topic lấy từ một câu gốc thật, chỉ "thay áo".

Câu sibling là **câu pool bình thường** — `pop` / `count` / `refill` không đổi. Cột `english_question_pool.sourceQuestionId` chỉ là thuộc tính provenance (lọc "sibling của #X", cron auto ưu tiên câu gốc chưa có sibling).

## Loại câu hỗ trợ

Chỉ **9 loại** có "term trung tâm" rõ ràng. `odd-one-out` (không có 1 term), `paragraph` (đọc hiểu) và reading-\* (không nằm trong pool) **không** hỗ trợ — `POST` trả `400`.

| quizType         | Field khóa (byte-identical)                            | Field sinh mới (materially different)                                                               |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `vocab`          | `word`, `partOfSpeech`                                 | `wrongAnswers`, `wrongAnswerExplanations`, `explanation`, `exampleSentence`/`exampleTranslation`    |
| `phrase`         | `phrase`                                               | như trên (`correctAnswer` giữ nghĩa tương đương)                                                    |
| `idiom`          | `idiom`                                                | như trên                                                                                            |
| `slang`          | `slang`, `partOfSpeech`                                | như trên                                                                                            |
| `synonym`        | `word`, `questionType`, `partOfSpeech`                 | `correctAnswer` (có thể chọn đồng/trái nghĩa hợp lệ khác), `wrongAnswers`, giải thích, ví dụ        |
| `fillblank`      | `word`                                                 | `sentence`, `sentenceTranslation`, `highlightedWord`, `correctAnswerTranslation`, distractor + dịch |
| `conversation`   | `correctAnswer`                                        | `dialogueLines`, `sentence`, dịch, distractor + dịch, giải thích, ví dụ                             |
| `description`    | `correctAnswer`, `partOfSpeech`, `descriptionLanguage` | `description` (tình huống mới), `wrongAnswers`, giải thích, ví dụ                                   |
| `verb-use-match` | `format`, `targetPhrase`, `verb`, `noun`               | `sentence`, `wrongAnswers`, giải thích, ví dụ                                                       |

Map tra cứu: `SIBLING_SUPPORTED_QUIZ_TYPES` / `isSiblingSupported` (`questionTypes.ts`), `SIBLING_LOCK_FIELDS_BY_TYPE` (`prompt/sibling-prompt.ts`).

## Luồng

### Manual (`POST /admin/pool/siblings/:id`)

1. Admin chọn một câu pool → `POST /admin/pool/siblings/:id { count (1..5), model?, adminNote? }`.
2. `siblingQuestionService.generateSiblingsForSource(id, { context: 'manual', forceInsert: true })`:
   - Load câu gốc (`questionPoolService.getPoolQuestionById`), parse `questionData`, chặn loại không hỗ trợ (`BusinessLogicException`).
   - Lấy `lockedValues` theo `SIBLING_LOCK_FIELDS_BY_TYPE[quizType]`.
   - `resolveStudyModel('manual', model?)`.
   - Dựng câu gốc dạng người đọc: **dùng lại** `buildLearnerView` / `buildAnswerKey` (`prompt/review-type-spec.ts`).
   - `generateStructuredOutput(z.object({ questions: array(perTypeSchema).max(5) }), { instructions: buildSiblingPrompt(...), input: learner view + answer key + RAW JSON, temperature: 0.7, maxOutputTokens: 6000 })`.
   - Validate từng candidate (xem "Ghi vào pool").
   - Insert thẳng các candidate đạt vào `english_question_pool` với `sourceQuestionId = :id` (một `db.transaction`).
3. Trả `SiblingGenResult` ngay (đồng bộ): `{ requested, generated, inserted, failed, skipped, tokenIn, tokenOut, model, poolQuestionIds, warnings }`.

Guard `activeSiblingSourceIds` (module state trong `siblingQuestion.service.ts`) chống double-submit cùng một câu gốc.

### Auto (cron `english-sibling-gen`)

Bật bằng `job_flags.siblingGenEnabled = true`. Scheduler upsert từ `sibling_gen_schedule` (reconcile lúc boot + khi config đổi, giống pool-refill).

1. Worker (`concurrency: 1`) mỗi lần chạy: `scanBuckets({ scope: 'deficient', thresholdCheck: 'target', filter: { quizTypes: SIBLING_SUPPORTED_QUIZ_TYPES } })` → bucket `currentCount < question_pool.maxPerBucket`.
2. Mở một `english_cron_job_runs` (`jobKey = 'sibling_gen'`).
3. Với mỗi bucket (tới khi đạt `sibling_gen.maxSiblingsPerRun`) — `processSiblingBucket(candidate, { forceInsert: false, ... })`:
   - Redis lock `question-pool:lock:{engLevel}:{topicId}:{quizType}` (`NX`, TTL 300s) — bỏ qua nếu đang bị giữ.
   - **`effectiveBudget = min(budget còn của run, candidate.deficiency)`** — mỗi bucket chỉ đặt sinh **vừa đủ để chạm `maxPerBucket`** (đếm `currentCount` từng bucket), KHÔNG đốt token cho phần chắc chắn bị pool cap bỏ. `sourceLimit = min(sourcesPerBucketPerRun, ceil(effectiveBudget / siblingsPerSource))`.
   - `pickSiblingSourceIds(...)` — câu gốc random, **chỉ câu `sourceQuestionId IS NULL`** (không sinh sibling từ sibling).
   - Mỗi câu gốc → `generateSiblingsForSource(id, { count: min(siblingsPerSource, budgetLeft), context: 'schedule', forceInsert: false })`. `insertSiblings` vẫn đếm bucket trong transaction làm chốt chặn cuối ở `maxPerBucket`.
   - Ghi `english_cron_job_buckets` + `recordModelAttempt`. Chi phí tính **theo từng câu gốc** trong `generateSiblingsForSource` bằng giá của **model đã cấu hình** (`configuredModel` = `ai_models.modelId`), không dùng `usage.model` (tên OpenRouter trả về đã bị cắt prefix, không khớp `ai_models`). Bucket cộng các lời gọi bằng `sumCostUsd` (null nếu không lời gọi nào có giá); attempt ghi danh sách model đã dùng. Lỗi một câu gốc → log + tiếp; lỗi bucket → bucket `status='failed'`, run vẫn chạy tiếp.
4. `summarizeRun(run, { forceFinishRunningBuckets: true })`.

### Manual bulk (`POST /admin/pool/siblings/refill`)

Bản admin-trigger của luồng auto — dùng cho tab "Câu tương tự" ở màn Sinh hàng loạt. Mẫu theo
`POST /admin/pool/refill` (`siblingRefill.service.ts`, dùng chung `processSiblingBucket` với cron).

1. `resolveStudyModels('manual', models?)` validate danh sách model (id lạ / tắt → 400).
2. `buildManualSiblingPlan({ scope, sourcesPerBucket?, siblingsPerSource?, filter, bucketKeys })`:
   - `scanBuckets({ scope: 'all', filter: { ...filter, quizTypes: ⊆ SIBLING_SUPPORTED } })` + `getSiblingSourceCountsByBucket()`.
   - Mỗi bucket: `maxSiblings = min(sourcesPerBucket, sourceCount) × siblingsPerSource`;
     `plannedCount = scope==='deficient' ? min(maxSiblings, max(0, deficiency)) : maxSiblings`;
     `plannedSources = ceil(plannedCount / siblingsPerSource)`. `sourcesPerBucket` / `siblingsPerSource` mặc định
     lấy từ `sibling_gen` config, admin ghi đè được (siblingsPerSource cap 5).
3. `startRun({ jobKey: 'sibling_gen_manual', trigger: 'manual' })` → `void executeManualSiblingPlanInProcess(...)`
   (`runWithConcurrency`, concurrency = `question_pool.manualFillConcurrency`, guard `activeManualRuns`), trả ngay
   `{ runId, totalBuckets }`.
4. Mỗi bucket: Redis lock → `processSiblingBucket(candidate, { context: 'manual', forceInsert: scope === 'all', budgetLeft: plannedCount, ... })`,
   model random theo bucket. `scope='deficient'` ⇒ `processSiblingBucket` cắt tiếp theo `candidate.deficiency` (không vượt `maxPerBucket`); `scope='all'` ⇒ ép sinh đủ `plannedCount`.
5. `summarizeRun(run, { forceFinishRunningBuckets: true })`. Preview: `GET /admin/pool/siblings/buckets` chạy chung
   `buildManualSiblingPlan` nên số liệu không lệch.

## Ghi vào pool

Mỗi candidate model trả về đi qua các cổng validate (`validateCandidate`):

1. **Schema loại** — `QUESTION_SCHEMA_BY_TYPE[quizType].safeParse` (nguồn: `study.service.ts`, dùng chung với AI review qua `prompt/question-schema-map.ts`). Fail → `failed++`.
2. **Khóa term** — mọi key trong `SIBLING_LOCK_FIELDS_BY_TYPE[quizType]` bị model đổi sẽ được **khôi phục cưỡng bức** từ câu gốc trước khi parse (ghi vào `warnings`).
3. **Độ dài mảng** — `wrongAnswers` / `wrongAnswerExplanations` / `optionTranslations` phải đúng `optionCount - 1`, index-aligned.
4. **Dedupe** — chữ ký ngữ cảnh (`sentence` / `dialogueLines` / `description` / bộ `wrongAnswers`, cộng `exampleSentence`) trùng byte câu gốc → `failed++` (model không thật sự đổi).

Candidate đạt → `INSERT INTO english_question_pool` (`sourceQuestionId = câu gốc`, `forBeginner` = cờ của câu gốc, token chia đều cho các candidate đạt). Câu gốc beginner → prompt sibling mô tả level theo chuẩn beginner (`describeLearnerLevel`), sibling nằm cùng bucket beginner (xem [`beginner.md`](./beginner.md)). Manual `forceInsert: true` bỏ qua cap; auto `forceInsert: false` tôn trọng `question_pool.maxPerBucket`.

## Endpoints (`Admin / Pool Sibling`, session admin)

| Method | Path                                   | Mô tả                                                                                                                                                                     |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/admin/pool/siblings/supported-types` | `[{ quizType, label, lockFields }]` — loại hỗ trợ + field khóa. UI dùng để bật/tắt nút.                                                                                   |
| `POST` | `/admin/pool/siblings/:id`             | body `{ count: 1..5, model?, adminNote? (≤1000) }` → `SiblingGenResultSchema`. Đồng bộ. Ghi thẳng vào pool. Loại không hỗ trợ → 400, câu gốc không tồn tại → 404.         |
| `GET`  | `/admin/pool/siblings/buckets`         | query `{ engLevels?, topicIds?, quizTypes? (CSV), scope?, sourcesPerBucket?, siblingsPerSource? }` → `PoolSiblingBucketPreviewSchema`. Chỉ đọc.                           |
| `POST` | `/admin/pool/siblings/refill`          | body `{ models?, scope?, sourcesPerBucket?, siblingsPerSource? (1..5), filter?, bucketKeys? }` → `{ runId, totalBuckets }`. Fire-and-forget, jobKey `sibling_gen_manual`. |

Lọc sibling trong pool: `GET /english/pool/questions?sourceQuestionId=<id>` hoặc `?onlySiblings=true` (thêm vào `ListPoolQuestionsInput`; `sourceQuestionId` thắng `onlySiblings`).

## Config (`english-config.md` §5)

| Key                                  | Mặc định                               | Ý nghĩa                                       |
| ------------------------------------ | -------------------------------------- | --------------------------------------------- |
| `job_flags.siblingGenEnabled`        | `false`                                | Bật cron auto (manual không phụ thuộc cờ này) |
| `sibling_gen.sourcesPerBucketPerRun` | `2`                                    | Số câu gốc lấy mỗi bucket mỗi lần chạy        |
| `sibling_gen.siblingsPerSource`      | `3`                                    | Số sibling sinh mỗi câu gốc (cap 5)           |
| `sibling_gen.maxSiblingsPerRun`      | `40`                                   | Trần tổng sibling mỗi lần chạy auto           |
| `sibling_gen_schedule.items`         | `[{ sibling-gen-daily, '0 3 * * *' }]` | Lịch cron, reconcile ngay khi đổi             |

## Giới hạn / lưu ý

- Chỉ 9 quizType (danh sách trên). Loại khác → `POST` trả `400`.
- Term cần học được **khóa nguyên văn** — model đổi thì service tự khôi phục + ghi `warnings`, không fail cả câu.
- Tối đa **5 sibling / một lần gọi LLM** (batch schema cap). `count > 5` → route trả `422`.
- **Không có bước duyệt** — câu đạt schema vào pool ngay. Chất lượng dựa vào prompt (`buildSiblingPrompt`) + 4 cổng validate + dedupe guard.
- Token của lần gọi được **chia đều** cho các candidate đạt (LLM không trả breakdown per-item).
- Không qua BullMQ ở manual; auto có scheduler + queue riêng `english-sibling-gen` (Bull Board `/queues`), tracking qua `english_cron_job_runs` (`jobKey = 'sibling_gen'`).
- Prompt/Zod question schema vẫn ở code — xem [`generate-question-common-rule.md`](./generate-question-common-rule.md).
