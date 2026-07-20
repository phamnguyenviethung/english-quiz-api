# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# English Quiz API

**Quiz Infra** — service hạ tầng quản lý quiz tiếng Anh qua HTTP API: sinh câu hỏi bằng LLM, question pool (pre-generate), config runtime, topic, và cron tracking. **Không** quản lý end-user (không có profile/streak/resources người chơi) và **không** có Discord bot / canvas rendering.

## Techstacks

- Runtime: **Bun** + TypeScript
- API: **ElysiaJS** (`elysia`, `@elysiajs/cors`, `@elysiajs/openapi`)
- DB: **Drizzle ORM** + PostgreSQL (`pg`)
- Cache/Queue: **IORedis** + **BullMQ**
- LLM: **OpenRouter** (`@openrouter/sdk`)
- Validation: **Zod**
- Logger: **Winston** (console-only, không có Discord transport)
- Docker

> Lưu ý: project khởi tạo từ `bun init` nên có cursor rule gợi ý dùng `Bun.sql`/`Bun.redis`. Nhưng stack thực tế giữ **Drizzle + IORedis + BullMQ** để tái dùng core logic từ `kakabot26`. Không dùng `Bun.sql`/`Bun.redis`.

## Commands

```bash
bun install
bun run dev            # dev với watch, dùng .env.local (bun --watch)
bun run start          # production, dùng .env
bun run build          # bundle src/index.ts → dist/

# Database (Drizzle)
bun run db:generate    # sinh migration SQL từ schema (src/core/db/schema/main.ts) → drizzle/
bun run db:push        # push schema thẳng vào DB (dev, không tạo migration file)
bun run db:migrate     # apply các migration file trong drizzle/ (dùng migrate.ts)
bun run db:studio      # Drizzle Studio
bun run db:seed:ai-models   # seed bảng ai_models (active model list)

# Docker
bun run docker:build
bun run docker:run     # entrypoint tự chạy `drizzle-kit migrate` khi NODE_ENV=production
```

Không có test runner được cấu hình. `drizzle.config.ts` load `.env` khi `NODE_ENV=production`, ngược lại `.env.local`.

Endpoint quan sát khi chạy: `GET /health`, `GET /openapi` (Swagger), `GET /queues` (Bull Board dashboard cho `english-question-gen` + `english-pool-refill`). Port mặc định `3220` (`PORT`).

## Bootstrap order (bắt buộc — `src/index.ts`)

1. `ensureEnglishConfigSeeded()` — seed config records vào DB **và** load snapshot vào memory. Phải chạy **trước** mọi thứ vì các service đọc config đồng bộ (xem dưới).
2. `startCron()` — init BullMQ workers/queues/schedulers; đồng thời cleanup các cron run bị stuck `running` từ session trước.
3. `startApi()` — Elysia listen.

Graceful shutdown (SIGTERM/SIGINT) đóng tất cả BullMQ queue/worker rồi `redisClient.quit()`.

## Kiến trúc cốt lõi (đọc kỹ trước khi sửa)

### 1. Config snapshot in-memory (`englishConfig.service.ts` + `englishConfig.defaults.ts`)

Config runtime lưu trong DB dưới dạng **typed EAV**: `english_config_records` (mỗi record 1 giá trị, có `valueText/valueNumber/valueBoolean/valueJson` + cột default tương ứng, phân biệt qua `english_config_record_types`).

Nhưng **service đọc config qua `getEnglishConfigSnapshot()` — một object trong memory, đồng bộ (không async)**. Đây là lý do bootstrap phải seed config đầu tiên. Snapshot gồm 3 namespace: `question_pool`, `quiz_distribution`, `job_flags`.

- Mỗi record map tới 1 đường dẫn trong snapshot qua `{ namespace, path }` (định nghĩa ở `ENGLISH_CONFIG_RECORD_DEFINITIONS`). `path = 'items'` nghĩa là namespace đó là root array (vd `quiz_distribution`).
- `refreshEnglishConfig()` build lại snapshot từ DB rồi gán vào biến module-level. `updateEnglishConfig()` / `resetEnglishConfigToDefault()` gọi nó sau khi commit.
- Giá trị DB hỏng schema → fallback về default + `logger.warn` (trừ khi đang update chính namespace đó thì throw).
- **Thêm 1 config mới**: thêm định nghĩa vào `ENGLISH_CONFIG_RECORD_DEFINITIONS`, cập nhật default + Zod schema tương ứng trong `englishConfig.defaults.ts`. Seed tự upsert khi metadata đổi.

### 2. Question pool — mô hình "bucket" (`questionPool.service.ts`)

Câu hỏi được pre-generate và lưu ở `english_question_pool`. **Bucket = `(engLevel, topicId, quizType)`**. `topicId = null` là 1 bucket hợp lệ (câu không gắn topic).

- `popQuestion(engLevel, topicId)`: lấy **1 câu RANDOM** trong bucket theo `(engLevel, topicId)` — `ORDER BY RANDOM() LIMIT 1`, **không** lọc theo quizType. Câu **không** bị xóa/đánh dấu, nên có thể được trả lại ở lần pop sau (pool là kho câu dùng lại được). Không còn khái niệm `used`/fresh-vs-reuse.
- `getPoolCount(engLevel, quizType, topicId)`: đếm **tổng số câu** trong bucket (không có filter `used`). Đây là tồn kho thực, dùng cho mọi phép tính deficiency/refill.
- `pushQuestions()`: insert nhiều câu, **respect cap** `question_pool.maxPerBucket` per bucket (đếm lại trong transaction để không vượt — cap áp trên tổng số câu bucket).
- `pickQuizType()`: chọn quizType theo `quiz_distribution` (weighted random, chỉ item `enabled && weight>0`), qua `src/utils/chance.ts`.
- Ngưỡng refill = `ceil(maxPerBucket * refillThresholdRatio)`.

### 3. Sinh câu hỏi & luồng BullMQ

Có **hai đường** tạo câu hỏi:

- **On-demand (API)**: `POST /english/generate/:quizType` → `studyService.generateXQuestion(...)` (single). Không đụng pool. `generate-reading` là loại đặc biệt (không nằm trong `quiz_distribution`).
- **Pool fill (background)**: qua `fillBucketDetailed()` trong `question-gen.job.ts` — hàm trung tâm mọi luồng fill. Nó gọi `studyService.generateXBatch(...)` (batch 1–5 câu), validate, `pushQuestions()`, và ghi cron tracking.

`study.service.ts` (singleton `StudyService`) chứa toàn bộ logic gọi LLM: mỗi quizType có method single + batch, mỗi cái build prompt (từ `prompt/*`) + `buildDifficultyInstruction(ctx)` rồi gọi `generateStructuredOutput`. **Validate output rất chặt** (đúng số wrong answers, `___` trong fill-blank, description không leak đáp án, v.v.) — sai format thì throw/loại bỏ.

`generateStructuredOutput` (`aiClient.config.ts`): ép model trả structured output qua **tool call `structured_output`** (`toolChoice: 'required'`, Zod → JSON Schema). Có fallback parse JSON từ content (strip `<think>` của Qwen) cho model không gọi tool. **Không dùng `callModel`** — dùng `chat.send` non-stream để né lỗi parse SSE.

Ba BullMQ jobs (`src/core/cron/`):

| Job | Queue(s) | Trigger | Vai trò |
|---|---|---|---|
| `question-gen` | `english-question-gen` | enqueue từ `questionPoolTrigger.ensurePoolFilled` | Fill 1 bucket khi pool tụt dưới threshold. `jobId` = `refill_<engLevel>_<topicId>_<quizType>` để **dedupe** job trùng. |
| `pool-refill` | `english-pool-refill` (parent) + `english-pool-refill-child` | cron `0 5/12/20 * * *` (TZ Asia/Ho_Chi_Minh) | Scan **mọi** bucket, dùng `FlowProducer` tạo parent + N children. Bị chặn bởi `job_flags.poolRefillEnabled` và cap `poolRefillMaxQuestionsPerRun`. |
| `manual-fill` | (không dùng BullMQ) | `triggerManualFill()` | Fill tất cả bucket in-process với concurrency (`question_pool.manualFillConcurrency`), `skipPoolCheck=true`. Chống double-run bằng `activeManualRuns` set. |

`questionPoolTrigger.ensurePoolFilled` là điểm vào chính từ API (`POST /english/pool/fill`): kiểm tra `job_flags.questionGenEnabled` + count vs threshold rồi mới enqueue.

### 4. Cron tracking (`englishCronJobTracking.service.ts`)

Mọi lần generate được ghi 3 tầng: **run → bucket → model attempt** (`english_cron_job_runs` / `_buckets` / `_model_attempts`). Job code gọi `startRun/startBucket/finishBucket/summarizeRun/recordModelAttempt`. `markStaleRunsFailed` (chạy lúc init) đóng run kẹt >2h. Xem qua `GET /english/cron/runs`.

### 5. AI models

`aiClient.getStudyModels()` đọc model active từ bảng `ai_models` (`aiModel.service`); rỗng thì fallback về `MODELS` hardcode. `pickStudyModel` trả `GEMINI_FLASH_LITE` khi `NODE_ENV=development`, ngược lại random 1 model active.

### API response shape

Dùng helper ở `src/api/common/response.ts`: `ok(data)` → `{ success, data }`, `notFound(msg)` → 404 Response. Route file: `src/api/routes/english.route.ts` (tất cả prefix `/english`).

## Coding

- Đặt tên biến, hàm bằng tiếng Anh, dễ hiểu
- Throw exception có message rõ ràng (`BusinessLogicException` ở `src/core/exceptions/`)
- Dùng logger hợp lý cho các logic quan trọng
- Dùng transaction (`db.transaction`) cho mọi thao tác create/update/delete
- Comment chỉ cho đoạn code quan trọng, khó hiểu
- Import dùng alias `@/*` → `src/*`

## Tin nhắn & phản hồi với user

- Sử dụng hoàn toàn tiếng Việt, thân thiện

## Docs

- Folder: `/docs/**` — tham khảo `question-pool.md`, `english-config.md`, `generate-question-common-rule.md`. Update docs khi sửa feature tương ứng.
