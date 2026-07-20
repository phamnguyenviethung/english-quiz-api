# Question Pool — Pre-generation System

## Tổng quan

Thay vì gọi AI trực tiếp mỗi khi cần 1 câu hỏi (gây delay + rủi ro lỗi JSON), hệ thống **pre-generate** câu hỏi và lưu vào DB. Client lấy câu qua API `GET /english/pool/pop` theo **engLevel + topicId**.

```
GET /english/pool/pop?engLevel=A2&topicId=5
     │
     ▼
 popQuestion(engLevel, topicId)  →  ORDER BY RANDOM() LIMIT 1
     │
  có câu ──────────► trả về (câu vẫn nằm lại pool, có thể pop lại lần sau)
     │
    null ──────────► 404 "Pool trống cho bucket này"
                     (client tự gọi /pool/fill để refill, hoặc chờ scheduled refill)
```

Pool được nạp đầy bởi 3 cơ chế: **on-demand** (`POST /pool/fill`), **scheduled** (cron 3 lần/ngày), và **manual** (`triggerManualFill`).

---

## Pool Bucket

Pool được phân theo **3 chiều**: **`(engLevel, topicId, quizType)`**.

- `getPoolCount(engLevel, quizType, topicId)` đếm **tổng số câu** trong bucket — không còn khái niệm "unused/fresh".
- `POOL_MAX_PER_BUCKET` (`question_pool.maxPerBucket`, default **3**) — tối đa 3 câu mỗi bucket.
- Refill threshold: **`getRefillThreshold()`** = `ceil(maxPerBucket * refillThresholdRatio)` = `ceil(3 * 0.5)` = **2** — khi số câu trong bucket `< 2` → cần refill.
- Bucket đầy (đủ 3 câu) → `pushQuestions` bỏ qua insert cho bucket đó, không overwrite.

**Ví dụ**: bucket `(B2, 5, fillblank)` chứa tối đa 3 câu fillblank cho engLevel B2 và topic id `5`.

**`topicId = null`**: vẫn hợp lệ trong schema (nullable). Điều kiện SQL dùng `topicId IS NULL` cho bucket "không topic".

---

## popQuestion — random thuần

`popQuestion(engLevel, topicId)`:

1. `SELECT * FROM english_question_pool WHERE engLevel = ? AND (topicId = ? | topicId IS NULL) ORDER BY RANDOM() LIMIT 1`.
2. Có row → trả về `PoolQuestion`. **Không** `UPDATE`, **không** `DELETE` — câu vẫn nằm trong pool và có thể được trả lại ở lần pop sau. Pool là **kho câu hỏi dùng lại được**.
3. Không có row nào khớp engLevel + topicId → trả `null`.

> Không lọc theo `quizType` khi pop — quizType của câu trả về là ngẫu nhiên trong bucket theo `(engLevel, topicId)`.

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
```

> Bucket chỉ gồm `engLevel` + `topicId` + `quizType`. Không có cột `used` — pop không tiêu thụ câu.

---

## Các file chính

### 1. `src/core/services/english/questionPool.service.ts`

| Function                                    | Mô tả                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `getPoolCount(engLevel, quizType, topicId)` | Đếm **tổng số câu** trong bucket `(engLevel, topicId, quizType)`             |
| `popQuestion(engLevel, topicId)`            | `ORDER BY RANDOM() LIMIT 1`; không xóa/đánh dấu; trả `PoolQuestion \| null`   |
| `pushQuestions(questions[])`                | Insert batch; kiểm tra capacity (tổng câu) theo từng bucket trước khi insert |
| `clearPool(engLevel?, topicId?)`            | Xóa pool (filter tùy chọn theo engLevel / topicId)                           |
| `pickQuizType()`                            | Random quiz type theo `quiz_distribution` (weighted)                         |

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
2. `needed = maxPool - currentCount`; `batchCount = min(requestedCount, needed)` với `requestedCount = clamp(count, 1, 5)`.
3. Gọi **`generateBatch`** cho đúng `quizType` với model duy nhất (`ctx.model = GEMINI_FLASH_LITE`). AI call fail → throw ngay, bucket ghi `status = failed`, **không retry model khác**.
4. Mỗi phần tử trong kết quả → một `PushQuestionInput` (kèm `topicId`, token usage).
5. Nếu sau batch vẫn thiếu chỗ: thử bù tối đa **2** câu với **`pickQuizType()`** ngẫu nhiên (cùng `topicName`).
6. `pushQuestions(generated)`; đồng thời `DEL` Redis lock key trong `finally`.

**Concurrency**: 2 job song song. **Retry**: không cấu hình `attempts` → 0 retry.

**Dedup trigger**: `questionPoolTrigger` add job với `jobId = refill_{engLevel}_{topicId ?? 'null'}_{quizType}` — BullMQ loại trùng job cùng id trong queue.

---

### 3. `src/core/services/english/questionPoolTrigger.service.ts`

**`ensurePoolFilled(engLevel, topicId, topicName, quizType, optionCount)`** — điểm vào từ API `POST /english/pool/fill`:

1. **Feature flag**: nếu config `job_flags.questionGenEnabled` (default `true`) tắt → log và return ngay (không enqueue).
2. `getPoolCount(engLevel, quizType, topicId)` — tổng câu trong bucket.
3. Nếu `count >= threshold` → return.
4. `needed = maxPool - count` → add job với payload `{ engLevel, quizType, optionCount, topicId, topicName, count: needed }` và `jobId` cố định như trên.

> Dùng `getQuestionGenQueue()` getter — tránh lỗi khởi tạo queue sớm.

---

## Khởi động hệ thống

- `src/core/cron/index.ts` gọi `questionGenJob()`, `poolRefillJob()`, `manualFillJob()` khi app start → khởi tạo queue và worker
- `src/api/api.ts` đăng ký `questionGenQueue` và `poolRefillQueue` vào Bull Board → monitor tại `/queues`

---

## Scheduled Pool Refill — Proactive Refill

### `src/core/cron/pool-refill.job.ts`

Ngoài on-demand refill, hệ thống có **scheduled refill** chạy proactive 3 lần/ngày để giữ pool luôn đầy.

**Lịch chạy**: 5:00, 12:00, 20:00 (Asia/Ho_Chi_Minh)

**Kiến trúc**: BullMQ Flow (parent–children)

```
Scheduler (upsertJobScheduler × 3 mốc giờ)
    │
    ▼
Parent job (pool-refill-scan)
    │  Quét mọi bucket: 4 engLevel × active topics (+ null) × enabled quiz types
    │  Mỗi bucket thiếu → tạo 1 child job
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
  (generateBatch + pushQuestions, max 5 câu/lần)
```

**Queue**: `english-pool-refill` (parent + scheduler), `english-pool-refill-child` (children)

**Feature flag**: trước khi scan, parent worker kiểm tra `job_flags.poolRefillEnabled` (default `true`). Nếu tắt → log và return ngay, không tạo tracking run.

**Scan logic (parent)**:

1. `topicService.getAllActiveTopics()` + `null` (no-topic bucket)
2. Với mỗi tổ hợp `(engLevel, topicId, quizType)` → `getPoolCount()` → nếu `< maxPool` → tạo child
3. `count = min(needed, 5)` — mỗi child tối đa sinh 5 câu
4. **Limit tổng câu/run**: đếm dồn `plannedQuestions`. Khi chạm `job_flags.poolRefillMaxQuestionsPerRun` (default `50`) → clamp bucket cuối cho vừa trần rồi dừng tạo child (tối ưu cost AI).
5. Tất cả bucket đã đầy → parent hoàn thành ngay, không tạo children

**Retry**: không có. Mỗi child chỉ chạy 1 lần — fail thì ghi bucket `status = failed` và tiếp tục các child khác.

**Stuck-running safeguard**:

- Parent job hoàn thành → gọi `summarizeRun` với `forceFinishRunningBuckets: true` để force-close bucket còn `running`.
- Lúc app khởi động, `markStaleRunsFailed(2h)` mark mọi run `running` quá 2 giờ thành `failed` (xử lý crash/OOM).

**optionCount**: A1/A2 → 4, B1/B2 → 5

---

## Manual Fill

Ngoài scheduled + on-demand, hệ thống hỗ trợ **fill thủ công** qua `triggerManualFill({ model, countPerBucket })` (`src/core/cron/manual-fill.job.ts`).

- Không dùng BullMQ — chạy in-process bằng `runWithConcurrency`.
- Scan toàn bộ: 4 engLevel × enabled quiz types × tất cả active topics → tạo bucket cho mỗi tổ hợp.
- `skipPoolCheck = true` — fill thêm bất kể bucket đã đầy chưa.
- Force dùng đúng model đã chọn (không fallback).
- Concurrency: `question_pool.manualFillConcurrency`. Chống double-run bằng `activeManualRuns` set.
- Fire-and-forget: trả `{ runId, totalBuckets }` ngay, job chạy nền và tự `summarizeRun`.

## Monitor

Run tracking (run → bucket → model attempt) ghi vào DB (`english_cron_job_runs` / `_buckets` / `_model_attempts`). Xem qua API `GET /english/cron/runs`, `GET /english/cron/runs/:runId`, hoặc Bull Board tại `/queues`.
