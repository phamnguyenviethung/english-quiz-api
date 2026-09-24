# Question Pool — Pre-generation System

## Tổng quan

Thay vì gọi AI trực tiếp mỗi khi cần 1 câu hỏi (gây delay + rủi ro lỗi JSON), hệ thống **pre-generate** câu hỏi và lưu vào DB. Client lấy câu qua API `GET /english/pool/pop` theo **engLevel + topicId**.

```
GET /english/pool/pop?engLevel=A2&topicId=5[&excludeIds=12,88,301]
     │
     ▼
 popQuestion(engLevel, topicId, excludeIds)  →  ORDER BY RANDOM() LIMIT 1
     │
  có câu ──────────► trả về (câu vẫn nằm lại pool, có thể pop lại lần sau)
     │
    null ──────────► 404 { success:false, error:{ code:"NOT_FOUND", message:"Pool trống cho bucket này" } }
                     (bucket rỗng, HOẶC mọi câu trong bucket đều bị excludeIds loại)
```

Pool được nạp đầy bởi 3 cơ chế, tất cả dùng chung 1 engine (`src/core/services/english/poolRefill.service.ts`):

| Cơ chế        | Trigger                                         | Scope bucket                                                                                | Target check                                  | Thực thi                        |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- |
| **On-demand** | `POST /english/pool/fill` (chỉ tài khoản admin) | 1 bucket cụ thể                                                                             | `ratio` — `< ceil(maxPerBucket*0.5)`          | BullMQ queue                    |
| **Scheduled** | cron (`pool_refill_schedule`)                   | tất cả bucket thiếu                                                                         | `target` — `< maxPerBucket`                   | BullMQ flow                     |
| **Manual**    | `POST /admin/pool/refill`                       | mặc định tất cả bucket (`scope=all`, hoặc `deficient`), lọc được theo `filter`/`bucketKeys` | không lọc (`all`) hoặc `target` (`deficient`) | In-process, bounded concurrency |

On-demand là backstop nhẹ cho quiz serving (pop-miss) — giữ nguyên ngưỡng ratio, không đổi. Scheduled + manual đều ưu tiên đạt đúng `maxPerBucket`, khác nhau ở việc có bị giới hạn `job_flags.poolRefillMaxQuestionsPerRun` hay không (scheduled có, manual admin không — xem "Manual Fill" bên dưới).

---

## Pool Bucket

Pool được phân theo **3 chiều**: **`(engLevel, topicId, quizType)`**.

- `getPoolCount(engLevel, quizType, topicId)` đếm **tổng số câu** trong bucket — không còn khái niệm "unused/fresh".
- `POOL_MAX_PER_BUCKET` (`question_pool.maxPerBucket`, default **3**) — tối đa 3 câu mỗi bucket.
- Refill threshold: **`getRefillThreshold()`** = `ceil(maxPerBucket * refillThresholdRatio)` = `ceil(3 * 0.5)` = **2** — khi số câu trong bucket `< 2` → cần refill.
- Bucket đầy (đủ 3 câu) → `pushQuestions` bỏ qua insert cho bucket đó, không overwrite.

**Ví dụ**: bucket `(B2, 5, fillblank)` chứa tối đa 3 câu fillblank cho engLevel B2 và topic id `5`.

**`topicId = null`**: vẫn hợp lệ trong schema (nullable). Điều kiện SQL dùng `topicId IS NULL` cho bucket "không topic".

**Bucket beginner**: cột `forBeginner` là chiều thứ 4 của bucket — câu beginner (≤ B1, 4 đáp án, sinh bằng prompt beginner) nằm ở bucket riêng, key `${engLevel}:${topicId}:${quizType}:beginner` (luôn qua `bucketKeyOf()`), đếm/pop/refill tách hẳn khỏi câu thường. `getPoolCount(..., forBeginner = false)`, `popQuestion(..., forBeginner = false)`. Chi tiết: [`beginner.md`](./beginner.md).

---

## popQuestion — random thuần

`popQuestion(engLevel, topicId, excludeIds, allowedQuizTypes, forBeginner = false)`:

1. `SELECT * FROM english_question_pool WHERE engLevel = ? AND (topicId = ? | topicId IS NULL) AND forBeginner = ? [AND id NOT IN (...)] [AND quizType IN (<allow-list của tenant>)] ORDER BY RANDOM() LIMIT 1`.
2. Có row → trả về `PoolQuestion`. **Không** `UPDATE`, **không** `DELETE` — câu vẫn nằm trong pool và có thể được trả lại ở lần pop sau. Pool là **kho câu hỏi dùng lại được**.
3. Không có row nào khớp → trả `null`.

> Client không chọn `quizType` khi pop — quizType của câu trả về là ngẫu nhiên trong bucket theo `(engLevel, topicId)`, **nhưng chỉ trong allow-list quizType của tenant** (`tenant_quiz_type_access`; `allowAllQuizTypes` / session admin = không giới hạn). Tenant chưa được cấp quizType nào → không có câu nào → 404. Vì pop không nhận quizType cụ thể nên allow-list được áp dụng bằng **lọc kết quả** (như `/topics`), không trả 403.

### `excludeIds` — chống lặp câu phía client

Pool **không biết end-user là ai** (không có cột `used`, không có bảng progress — xem `tenant-auth.md`). Việc "user này đã gặp câu nào" thuộc về client, nên client gửi kèm danh sách id cần loại:

| Khía cạnh | Hành vi                                                       |
| --------- | ------------------------------------------------------------- |
| Format    | CSV, vd `excludeIds=12,88,301`                                |
| Giới hạn  | tối đa **200** id, dư bị cắt; trùng lặp được khử              |
| Input rác | phần tử không phải số nguyên dương bị **bỏ qua**, không throw |
| Rỗng      | không truyền / rỗng / toàn rác → không lọc gì                 |

Loại hết câu trong bucket cũng trả **404** giống bucket rỗng — API không phân biệt hai trường hợp này. Client nên xử lý bằng một **ladder** giảm dần độ nghiêm ngặt, ví dụ:

```text
1. pop(engLevel, topicId,      excludeIds=seen)   → câu mới, topic đang chọn
2. pop(engLevel, otherTopicId, excludeIds=seen)   → câu mới, topic khác
3. pop(engLevel, topicId)                          → chấp nhận lặp
4. 404 → báo user thử lại sau
```

---

## Browse pool — `GET /english/pool/questions`

Endpoint đọc phục vụ admin UI (màn "Kho câu hỏi" trên dashboard). Cần tenant API key hợp lệ.

| Query param    | Kiểu               | Mặc định  | Ghi chú                                                                             |
| -------------- | ------------------ | --------- | ----------------------------------------------------------------------------------- |
| `engLevel`     | `A1\|A2\|B1\|B2`   | không lọc |                                                                                     |
| `quizType`     | quizType hợp lệ    | không lọc | Ngoài allow-list của tenant → 403                                                   |
| `topicId`      | number             | không lọc | Ngoài allow-list của tenant → 403                                                   |
| `withoutTopic` | boolean            | `false`   | Lọc riêng bucket `topicId IS NULL`; **thắng** `topicId`                             |
| `model`        | string             | không lọc | So khớp chính xác tên model                                                         |
| `optionCount`  | number, 1..10      | không lọc | Số đáp án của câu (pool thực tế là 4 cho A1/A2, 5 cho B1/B2)                        |
| `createdFrom`  | ISO date-time      | không lọc | `createdAt >= createdFrom`                                                          |
| `createdTo`    | ISO date-time      | không lọc | `createdAt <= createdTo`                                                            |
| `q`            | string, ≤100 ký tự | không lọc | ILIKE trên `questionData` + `model`; nếu toàn số thì thêm nhánh khớp chính xác `id` |
| `sort`         | xem bên dưới       | `id_asc`  |                                                                                     |
| `page`         | number, 1-based    | `1`       |                                                                                     |
| `pageSize`     | number, 1..100     | `20`      | > 100 → 400 VALIDATION                                                              |

Giá trị `sort` hợp lệ: `id_asc`, `id_desc`, `created_asc`, `created_desc`, `token_asc`, `token_desc`. `token_*` sắp xếp theo tổng `tokenIn + tokenOut`. `created_*` và `token_*` không unique nên luôn tie-break thêm bằng `id` để phân trang không trùng/sót row.

`createdAt` nullable (row cũ có thể `NULL`) — khi truyền `createdFrom`/`createdTo` thì các row đó bị loại khỏi kết quả. Index `idx_question_pool_created_at` phục vụ cả filter lẫn sort theo ngày.

`q` được escape trước khi đưa vào `ILIKE` (`%`, `_`, `\` do người dùng gõ không được coi là wildcard). Ở quy mô hiện tại (~vài nghìn câu) seq scan `ILIKE %...%` đủ nhanh nên chưa cần index; nếu pool lớn lên đáng kể, cân nhắc extension `pg_trgm` + GIN index trên `questionData`.

Response `ok()` bọc object phân trang (không dùng `list()` vì helper đó chỉ gắn `total = data.length`):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 333,
        "quizType": "paragraph",
        "engLevel": "A1",
        "optionCount": 4,
        "questionData": "{...}",
        "model": "...",
        "tokenIn": 0,
        "tokenOut": 0,
        "topicId": 25,
        "topicName": "Skincare",
        "createdAt": "2026-07-31T23:18:22.955Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 4426,
    "totalPages": 222
  }
}
```

`topicName` = `displayName ?? name` của topic (leftJoin `english_topics`), `null` khi câu không gắn topic. `total` là tổng số câu khớp filter, độc lập với `page`.

---

## List models — `GET /english/pool/models`

Trả về các model đang có câu trong pool kèm số lượng, sắp xếp giảm dần theo số câu. Dùng để đổ dropdown filter `model` ở admin UI (không hardcode danh sách model ở dashboard). Không có query param. Cần tenant API key hợp lệ.

```json
{
  "success": true,
  "data": [
    { "model": "google/gemini-2.5-flash-lite:nitro", "count": 3120 },
    { "model": "x-ai/grok-4.1-fast", "count": 1306 }
  ]
}
```

Khác `ai_models` table ở chỗ đây là model **thực tế đã sinh ra câu đang nằm trong pool**, kể cả model đã bị gỡ khỏi config.

---

## Database Schema

Bảng **`english_topics`** — chủ đề học (`src/core/db/schema/main.ts`)

```sql
CREATE TABLE english_topics (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  displayName text,
  description text,
  isActive    boolean NOT NULL DEFAULT true,
  createdAt   timestamp DEFAULT now(),
  updatedAt   timestamp DEFAULT now()
);
```

Bảng **`english_question_pool`**

```sql
CREATE TABLE english_question_pool (
  id           serial PRIMARY KEY,
  quizType     text NOT NULL,
  engLevel     text NOT NULL,
  optionCount  integer NOT NULL,
  questionData text NOT NULL,
  model        text NOT NULL,
  tokenIn      integer NOT NULL DEFAULT 0,
  tokenOut     integer NOT NULL DEFAULT 0,
  topicId      integer REFERENCES english_topics(id),
  createdAt    timestamp DEFAULT now()
);

CREATE INDEX idx_question_pool_bucket     ON english_question_pool ("engLevel", "quizType", "topicId");
CREATE INDEX idx_question_pool_created_at ON english_question_pool ("createdAt");
```

> Bucket chỉ gồm `engLevel` + `topicId` + `quizType`. Không có cột `used` — pop không tiêu thụ câu.

---

## Các file chính

### 1. `src/core/services/english/questionPool.service.ts`

| Function                                     | Mô tả                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `getPoolCount(engLevel, quizType, topicId)`  | Đếm **tổng số câu** trong bucket `(engLevel, topicId, quizType)`                               |
| `popQuestion(engLevel, topicId, excludeIds)` | `ORDER BY RANDOM() LIMIT 1`, loại `excludeIds`; không xóa/đánh dấu; trả `PoolQuestion \| null` |
| `listQuestions(input)`                       | List có filter + phân trang cho admin UI; trả `{ items, page, pageSize, total, totalPages }`   |
| `pushQuestions(questions[])`                 | Insert batch; kiểm tra capacity (tổng câu) theo từng bucket trước khi insert                   |
| `clearPool(engLevel?, topicId?)`             | Xóa pool (filter tùy chọn theo engLevel / topicId)                                             |
| `pickQuizType()`                             | Random quiz type theo `quiz_distribution` (weighted)                                           |

**`pushQuestions`**: gom bucket key `engLevel:topicId:quizType`, preload count, cập nhật in-memory sau mỗi insert trong cùng transaction để không vượt `maxPerBucket`.

---

### 2. `src/core/cron/question-gen.job.ts`

BullMQ Worker generate câu hỏi bất đồng bộ theo **batch** (nhiều câu một lần gọi AI).

**Queue name**: `english-question-gen`

**Job data**:

```typescript
interface QuestionGenJobData {
  engLevel: 'A1' | 'A2' | 'B1' | 'B2';
  quizType: QuizType; // loại refill chỉ định
  optionCount: 4 | 5;
  topicId: number | null; // khớp bucket pool
  topicName: string | null; // truyền vào prompt làm ràng buộc chủ đề
  count: number; // 1–5 (clamp trong worker); thường = số slot cần bù
  trackingRunId?: string;
}
```

**Luồng xử lý chính** (`fillBucketDetailed` / `processQuestionGenJob`):

1. Đếm **tổng câu** trong bucket `(engLevel, topicId, quizType)` — nếu đã đủ `maxPool` → skip.
2. `needed = maxPool - currentCount`; `batchCount = min(requestedCount, needed)` với `requestedCount = clamp(count, 1, question_pool.perBucketGenerationCap)` (config, mặc định 5).
3. Gọi **`generateBatch`** cho đúng `quizType` với **một** model duy nhất. Không truyền `model` vào `fillBucketDetailed` → tự chọn qua `pickStudyModelForContext('schedule')` (xem "Chọn model" bên dưới). AI call fail → throw ngay, bucket ghi `status = failed`, **không retry model khác**.
4. Mỗi phần tử trong kết quả → một `PushQuestionInput` (kèm `topicId`, token usage).
5. Nếu sau batch vẫn thiếu chỗ: thử bù tối đa **2** câu với **`pickQuizType()`** ngẫu nhiên (cùng `topicName`).
6. `pushQuestions(generated)` (re-check sức chứa bucket trong transaction). Job **không** đụng tới Redis lock `question-pool:lock:*` — lock đó thuộc luồng sibling.

**Concurrency**: 2 job song song. **Retry**: không cấu hình `attempts` → 0 retry.

**Dedup trigger**: `runOnDemandRefill` add job (`buildOnDemandRefillJob`) với BullMQ `deduplication.id = refill_{engLevel}_{topicId ?? 'null'}_{quizType}` — mỗi bucket tối đa 1 job đang chờ/chạy. Dedup id được nhả khi job **completed hoặc failed**, nên job fail không chặn các lần refill sau. (Trước đây dùng `jobId` cố định: job fail nằm lại trong failed set (`removeOnFail: 100`) khiến mọi lần add sau của bucket đó bị BullMQ bỏ qua — bucket `topicId = null` không được cron quét nên mất hẳn đường refill.)

---

### 3. `src/core/services/english/poolRefill.service.ts` — engine chung

Toàn bộ logic "cần refill gì, refill bao nhiêu, refill bằng cách nào" nằm ở đây, dùng chung cho cả 3 cơ chế:

| Function                                                                 | Vai trò                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `scanBuckets({ scope, thresholdCheck, filter, bucketKeys })`             | Quét `topic × engLevel × quizType`, trả candidate list đã sort (xem "Chống đói bucket" bên dưới)              |
| `buildRefillPlan(candidates, opts)`                                      | Hàm thuần — cắt candidate list theo budget (`maxQuestionsPerRun`) + cap per-bucket (`perBucketCap`), trả plan |
| `buildManualRefillPlan(params)`                                          | Scan + plan cho manual fill, trả `{ matched, plan }` — dùng chung cho preview lẫn lúc chạy thật               |
| `runScheduledRefill(flowProducer, trigger)`                              | `scope=deficient, thresholdCheck=target`, có budget, build BullMQ flow                                        |
| `runOnDemandRefill(bucket)`                                              | 1 bucket, `thresholdCheck=ratio`, enqueue 1 job — hành vi giữ nguyên như bản cũ                               |
| `runManualRefill({ models, countPerBucket, scope, filter, bucketKeys })` | `scope=all` mặc định, không giới hạn budget, chạy in-process bounded concurrency                              |

**Lọc bucket**: `filter` thu hẹp không gian bucket theo từng chiều (`engLevels` / `topicIds` / `quizTypes`); chiều nào bỏ trống thì không lọc theo chiều đó. `bucketKeys` chốt đúng một danh sách bucketKey cụ thể và được áp dụng **sau** `filter` — dùng khi admin bỏ tick vài bucket trong màn preview của dashboard. Cả hai bỏ trống → quét toàn bộ như trước.

**Count bucket**: `scanBuckets` lấy count của mọi bucket bằng **một** query `GROUP BY engLevel, quizType, topicId` (`questionPoolService.getPoolCountsByBucket`), không gọi `getPoolCount` lần lượt cho từng bucket — số bucket là `topics × 4 × quizTypes` nên cách cũ tạo hàng nghìn round-trip mỗi lần scan.

**Chống đói bucket (starvation fix)**: `scanBuckets` sort theo `(deficiency giảm dần, lần refill thành công gần nhất tăng dần — null trước, bucketKey tăng dần)`. Tiêu chí thứ 2 lấy từ `MAX(finishedAt)` trên `english_cron_job_buckets` (không cần cột/bảng mới) — đảm bảo khi 1 lần chạy bị budget-cap giữa chừng, lần chạy sau **ưu tiên đúng những bucket bị bỏ sót lần trước**, thay vì luôn quét theo thứ tự cố định topic → engLevel → quizType và làm đói mãi mãi các bucket cuối danh sách.

**`questionPoolTrigger.service.ts`** (`ensurePoolFilled`) vẫn là entrypoint của `POST /english/pool/fill`, nhưng giờ chỉ là 1 dòng delegate sang `poolRefillService.runOnDemandRefill(...)`.

---

## Chọn model & provider routing

Model không còn hardcode. Nguồn sự thật là bảng `ai_models` (CRUD qua `/admin/models*`), mỗi row có 2 cờ bật/tắt độc lập và 2 bộ provider routing riêng:

| Cột                                               | Ý nghĩa                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| `isActive`                                        | Tắt hẳn model, không dùng ở bất kỳ context nào                              |
| `scheduleEnabled` / `manualEnabled`               | Model có nằm trong pool chọn ngẫu nhiên của từng context hay không          |
| `scheduleProvider` / `manualProvider`             | `ProviderPreferences` của OpenRouter, pass thẳng vào `chatRequest.provider` |
| `pricePromptPerToken` / `priceCompletionPerToken` | Giá USD/token cache từ OpenRouter catalog, dùng tính `costUsd`              |

**Hai context** (`ModelContext` trong `src/configs/aiClient.config.ts`):

| Context      | Dùng ở đâu                                                            | Lọc theo          |
| ------------ | --------------------------------------------------------------------- | ----------------- |
| `'schedule'` | Scheduled refill, on-demand backstop, `/english/generate*` (mặc định) | `scheduleEnabled` |
| `'manual'`   | `POST /admin/pool/refill`                                             | `manualEnabled`   |

- `pickStudyModelForContext(context)` — random uniform trong pool đã lọc; pool rỗng → fallback về `MODELS` hardcode (không kèm provider). `NODE_ENV=development` luôn ghim `GEMINI_FLASH_LITE`.
- `resolveStudyModel(context, explicitModelId?)` — có chỉ định model thì vẫn **lấy provider routing của chính model đó** theo context, không bỏ qua config. Không validate model id (cho phép override chủ ý sang model chưa khai báo).
- `resolveStudyModels(context, modelIds?)` — bản nhiều model, dùng cho manual refill: trả cả tập để caller random lại ở từng bucket. Bỏ trống → toàn bộ pool của context. Khác bản số ít, hàm này **validate**: id không có trong `ai_models`, `isActive=false`, hoặc tắt cờ của context → `BusinessLogicException` (400) liệt kê rõ id nào sai, vì input đến từ dropdown admin.

**Giá & cost**: giá được nạp tự động lúc tạo model (và khi đổi `modelId`), refresh thủ công qua `POST /admin/models/:id/sync` hoặc `POST /admin/models/sync-all`. Duyệt catalog thật của OpenRouter qua `GET /admin/models/catalog?search=`. Model có suffix routing (`:nitro`, `:floor`) được so khớp với bản đã bỏ suffix trên catalog.

`costUsd = pricePrompt × tokenIn + priceCompletion × tokenOut`, ghi ở cả 3 mức `english_cron_job_model_attempts` → `_buckets` → `_runs`. Model chưa có giá cache → `costUsd = null` (phân biệt với `0` = model free). Xem tổng hợp chi tiêu qua `GET /english/cron/usage?groupBy=day|model`.

---

## Khởi động hệ thống

- `src/core/cron/index.ts` gọi `questionGenJob()`, `poolRefillJob()` khi app start → khởi tạo queue, worker, và reconcile BullMQ job schedulers theo config `pool_refill_schedule.items`
- `src/api/api.ts` đăng ký `questionGenQueue` và `poolRefillQueue` vào Bull Board → monitor tại `/queues`

---

## Scheduled Pool Refill — Proactive Refill

### `src/core/cron/pool-refill.job.ts`

Ngoài on-demand refill, hệ thống có **scheduled refill** chạy proactive theo lịch để giữ pool luôn đầy.

**Lịch chạy**: config-driven qua `pool_refill_schedule.items` (`[{ name, cron }]`), mặc định 3 mốc: 5:00, 12:00, 20:00 (Asia/Ho_Chi_Minh). Đổi giá trị này qua `PATCH /english/config/pool_refill_schedule.items` có hiệu lực **ngay lập tức, không cần restart** — `reconcilePoolRefillSchedulers()` diff danh sách desired vs BullMQ `getJobSchedulers()` hiện tại, xoá scheduler không còn trong config (`removeJobScheduler`) và upsert phần còn lại (`upsertJobScheduler`). Hàm này chạy 1 lần lúc boot và mỗi khi recordKey đó đổi (đăng ký qua `onEnglishConfigChanged`).

**Kiến trúc**: BullMQ Flow (parent–children), scan/plan logic nằm ở `poolRefillService.runScheduledRefill()` (xem mục "Engine chung" ở trên), job file chỉ giữ phần bootstrap queue/worker/scheduler.

```
Scheduler (upsertJobScheduler theo pool_refill_schedule.items)
    │
    ▼
Parent job (pool-refill-scan)
    │  poolRefillService.scanBuckets({ scope: 'deficient', thresholdCheck: 'target' })
    │  → buildRefillPlan (budget-aware, sort deficiency desc + least-recently-refilled)
    │  Mỗi bucket trong plan → tạo 1 child job
    ▼
┌─────────────┬──────────────┬──────────────┐
│  Child #1   │  Child #2    │  Child #N    │  ← độc lập, chạy song song (concurrency=3)
│  fill A2/   │  fill B2/    │  fill ...    │
│  topic-1/   │  null/       │              │
│  vocab      │  fillblank   │              │
└─────────────┴──────────────┴──────────────┘
    │               │               │
    ▼               ▼               ▼
  fillBucketDetailed() — shared với question-gen.job.ts
  (generateBatch + pushQuestions, cap = question_pool.perBucketGenerationCap câu/lần)
```

**Queue**: `english-pool-refill` (parent + scheduler), `english-pool-refill-child` (children) — tên queue export từ `poolRefillService` (`POOL_REFILL_PARENT_QUEUE`/`POOL_REFILL_CHILD_QUEUE`).

**Feature flag**: trước khi scan, parent worker kiểm tra `job_flags.poolRefillEnabled` (default `true`). Nếu tắt → log và return ngay, không tạo tracking run.

**Scan + plan logic** (`poolRefillService.scanBuckets` + `buildRefillPlan`):

1. `topicService.getAllActiveTopics()` + `null` (no-topic bucket) × 4 engLevel × enabled quiz types.
2. Bucket có `currentCount < maxPerBucket` → candidate, `deficiency = maxPerBucket - currentCount`.
3. Sort candidate theo `(deficiency giảm dần, lần refill thành công gần nhất tăng dần, bucketKey)` — xem "Chống đói bucket" ở mục Engine chung.
4. `buildRefillPlan`: mỗi bucket được cấp `count = min(deficiency, question_pool.perBucketGenerationCap)`; dừng nhận thêm bucket khi tổng `count` dồn chạm `job_flags.poolRefillMaxQuestionsPerRun` (default `50`) — bucket bị cắt ở lần chạy này sẽ đứng đầu danh sách ưu tiên ở lần chạy kế tiếp nhờ tiêu chí sort #2.
5. Tất cả bucket đã đầy → parent hoàn thành ngay, không tạo children.

**Retry**: không có. Mỗi child chỉ chạy 1 lần — fail thì ghi bucket `status = failed` và tiếp tục các child khác.

**Stuck-running safeguard**:

- Parent job hoàn thành → gọi `summarizeRun` với `forceFinishRunningBuckets: true` để force-close bucket còn `running`.
- Lúc app khởi động, `markStaleRunsFailed(2h)` mark mọi run `running` quá 2 giờ thành `failed` (xử lý crash/OOM).

**optionCount**: A1/A2 → 4, B1/B2 → 5

---

## Manual Fill

`POST /admin/pool/refill` — yêu cầu tài khoản admin (không phải tenant key), gọi `poolRefillService.runManualRefill({ models, countPerBucket, scope, filter, bucketKeys })`.

- Không dùng BullMQ — chạy in-process bằng `runWithConcurrency`, concurrency = `question_pool.manualFillConcurrency`.
- `models` bỏ trống → random trong mọi model bật `manualEnabled`; truyền tường minh → random trong đúng tập đó. **Random lại ở từng bucket**, không khoá cứng cả run vào 1 model, nên một lần refill trải đều trên các model admin chọn. `manualProvider` luôn lấy theo model được chọn cho bucket đó. Model không tồn tại trong `ai_models`, hoặc `isActive=false` / `manualEnabled=false` → 400 (`resolveStudyModels` ở `aiClient.config.ts`); khác `resolveStudyModel` không validate, vì ở đây id đến từ dropdown admin nên id lạ là lỗi nhập liệu chứ không phải override có chủ ý.
- `model` (số ít) vẫn nhận được, tương đương `models: [model]` — giữ cho client cũ.
- `scope: 'all'` (mặc định): scan toàn bộ bucket bất kể đầy/thiếu, force mỗi bucket đúng `countPerBucket` câu (mặc định `question_pool.manualFillDefaultCount` nếu không truyền) — tương đương `skipPoolCheck = true` của bản cũ.
- `scope: 'deficient'`: chỉ scan bucket còn thiếu, top-up đúng phần còn thiếu tới `maxPerBucket` (hoặc `countPerBucket` nếu truyền tường minh).
- `filter` / `bucketKeys`: thu hẹp tập bucket (xem "Lọc bucket" ở mục `poolRefill.service.ts`).
- **Không bị giới hạn** `job_flags.poolRefillMaxQuestionsPerRun` — đây là hành động admin chủ động, chấp nhận chi phí, khác với scheduled refill (có budget tự động).
- Chống double-run bằng `activeManualRuns` set (module state trong `poolRefill.service.ts`).
- Fire-and-forget: trả `{ runId, totalBuckets }` ngay (`totalBuckets` = số bucket thực sự được xếp lịch), job chạy nền và tự `summarizeRun`. Theo dõi tiến độ qua `GET /english/cron/runs/:runId` (admin key cũng gọi được endpoint này nhờ `ADMIN_TENANT` bypass ở `tenantAuth.plugin.ts`).

### Preview trước khi chạy

`GET /admin/pool/buckets` — chỉ đọc, không sinh câu, không tốn chi phí LLM. Nhận đúng bộ tham số `scope` / `countPerBucket` / filter như endpoint refill (filter dạng CSV: `?engLevels=A1,B2&topicIds=3,7&quizTypes=vocab`) và chạy chung `buildManualRefillPlan`, nên `summary.plannedBuckets` bằng đúng `totalBuckets` mà refill sẽ trả về với cùng tham số — preview không trôi khỏi thực tế.

Trả `{ buckets, summary }`:

- `buckets[]`: mọi bucket khớp filter, kèm `bucketKey`, `currentCount`, `deficiency`, và `plannedCount` = số câu sẽ sinh. `plannedCount = 0` nghĩa là bucket đã đủ câu và sẽ bị `scope=deficient` bỏ qua — trả về thay vì giấu, để UI nói được lý do.
- `summary`: `matchedBuckets` (khớp filter), `plannedBuckets`, `plannedQuestions`, `maxPerBucket`.

Dashboard dùng endpoint này cho màn refill: admin lọc chiều → thấy ngay số bucket và số câu sẽ sinh → bỏ tick bucket không cần → gửi `bucketKeys` còn lại sang `POST /admin/pool/refill`.

## Monitor

Run tracking (run → bucket → model attempt) ghi vào DB (`english_cron_job_runs` / `_buckets` / `_model_attempts`), kèm `costUsd` ở cả 3 mức. Xem qua API `GET /english/cron/runs`, `GET /english/cron/runs/:runId`, `GET /english/cron/usage` (tổng hợp chi tiêu theo ngày/model), hoặc Bull Board tại `/queues`.

## AI Review

Rà soát + sửa từng câu trong pool bằng LLM, lưu kết quả chờ admin approve để ghi đè `questionData`. Xem [`question-pool-review.md`](./question-pool-review.md). Bảng `english_question_pool_reviews`, endpoints `Admin / Pool Review` (`POST/GET /admin/pool/reviews`, `.../:id/approve|reject`). Approve là đường **duy nhất** cột `english_question_pool.updatedAt` được set.

## Sibling Question

Dựa vào một câu pool gốc, sinh ra các **biến thể** kiểm tra **đúng cùng term cần học** (từ/cụm/idiom/slang…), cùng độ khó, cùng topic, nhưng đổi mới ngữ cảnh / distractor / ví dụ / giải thích. Câu đạt validate được ghi **thẳng vào `english_question_pool`** (không có bước duyệt) — vẫn là câu pool bình thường, `pop` ra như mọi câu khác. Cột mới **`sourceQuestionId`** (nullable, FK tự trỏ về `english_question_pool.id`, `onDelete: set null`) đánh dấu provenance. Manual: `POST /admin/pool/siblings/:id` (đồng bộ). Auto: cron `english-sibling-gen` quét bucket thiếu, cờ `job_flags.siblingGenEnabled` + config `sibling_gen*`. Chỉ 9 loại có term trung tâm (không hỗ trợ `odd-one-out`, `paragraph`, reading-*). Xem [`sibling-question.md`](./sibling-question.md).
