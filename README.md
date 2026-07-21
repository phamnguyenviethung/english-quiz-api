# english-quiz-api

**Quiz Infra** — service hạ tầng quản lý quiz tiếng Anh qua HTTP: sinh câu hỏi bằng LLM, question pool (pre-generate), config runtime, topic, cron tracking. **Không** quản lý end-user (không profile/streak/resources người chơi) và **không** có Discord bot hay canvas rendering.

## Stack

Bun · TypeScript · ElysiaJS · Drizzle (PostgreSQL) · IORedis · BullMQ · OpenRouter · Zod · Winston

## Yêu cầu

- Bun
- PostgreSQL
- Redis
- OpenRouter API key

## Cài đặt & chạy

```bash
bun install
cp .env.example .env.local          # điền DATABASE_URL, REDIS_URL, OPENROUTER_API_KEY
bun run db:generate                 # tạo migration từ schema
bun run db:push                     # (hoặc db:migrate) apply schema vào DB
bun run db:seed:ai-models           # seed danh sách model active
bun run dev                         # chạy dev (watch)
```

Production: `bun run start` (Docker: `bun run docker:build` + `docker:run`; entrypoint tự chạy migrate khi `NODE_ENV=production`).

## Thứ tự khởi động (src/index.ts)

1. `ensureEnglishConfigSeeded()` — seed + load config snapshot vào memory
2. `startCron()` — init BullMQ jobs (question-gen, pool-refill, manual-fill)
3. `startApi()` — Elysia listen (mặc định port 3220)

## API

- OpenAPI docs: `GET /openapi`
- Queue dashboard (Bull Board): `GET /queues`
- Health: `GET /health`

Nhóm endpoint chính (prefix `/english`):

| Method   | Path                              | Mô tả                                                         |
| -------- | --------------------------------- | ------------------------------------------------------------- |
| GET      | `/quiz-types`                     | Danh sách quiz type                                           |
| POST     | `/generate/:quizType`             | Sinh 1 câu hỏi on-demand (vocab, fillblank, phrase, ...)      |
| POST     | `/generate-reading`               | Sinh câu hỏi reading (loại đặc biệt, ngoài pool)              |
| GET      | `/pool/pop`                       | Lấy 1 câu **random** từ pool theo bucket (không xóa/đánh dấu) |
| GET      | `/pool/count`                     | Đếm câu trong bucket                                          |
| POST     | `/pool/fill`                      | Trigger refill pool (enqueue BullMQ)                          |
| GET      | `/config`                         | Config snapshot hiện tại                                      |
| GET      | `/config/records`                 | Danh sách config records (admin)                              |
| PATCH    | `/config/:recordKey`              | Cập nhật 1 config                                             |
| POST     | `/config/:recordKey/reset`        | Reset config về default                                       |
| GET/POST | `/topics`                         | Danh sách / tạo topic                                         |
| GET      | `/cron/runs`, `/cron/runs/:runId` | Theo dõi các lần generate                                     |

## Docs

Xem `docs/` — `question-pool.md`, `english-config.md`, `generate-question-common-rule.md` (port từ bot gốc; phần Discord/canvas đã bỏ).
