# Plan Mode Guideline

- Không cần chạy lệnh migration Database
- Không cần tạo file SQL migration

## Techstacks

- Runtime: **Bun** + TypeScript
- API: **ElysiaJS** (`elysia`, `@elysiajs/cors`, `@elysiajs/openapi`)
- DB: **Drizzle ORM** + PostgreSQL (`pg`)
- Auth: **Better Auth** (session + role admin, `src/configs/auth.config.ts`) cho `/admin/*`; tenant API key cho `/english/*`
- Cache/Queue: **IORedis** + **BullMQ**
- Mail: **Resend** (`src/configs/mail.config.ts`) — hiện chỉ dùng cho reset password
- LLM: **OpenRouter** (`@openrouter/sdk`)
- Validation: **Zod**
- Logger: **Winston** (console-only, không có Discord transport)
- Docker

## Coding

- Đặt tên biến, hàm bằng tiếng Anh, dễ hiểu
- Throw exception có message rõ ràng (`BusinessLogicException` ở `src/core/exceptions/`)
- Dùng logger hợp lý cho các logic quan trọng
- Dùng transaction (`db.transaction`) cho mọi thao tác create/update/delete
- Comment chỉ cho đoạn code quan trọng, khó hiểu. Hạn chế dùng mọi nơi
- Import dùng alias `@/*` → `src/*`

## Docs

- Folder: `/docs/**` — tham khảo `question-pool.md`, `question-pool-review.md`, `sibling-question.md`, `reading-passage.md`, `reading-question.md`, `english-config.md`, `generate-question-common-rule.md`, `ai-model-provider.md`, `admin-auth.md`, `tenant-auth.md`, `beginner.md`. Update docs khi sửa feature tương ứng.

## Testing

- Chi tiết: `docs/testing.md`. Chạy: `bun run test` (hoặc `test:unit` / `test:integration` / `test:e2e`).
- Test dùng **DB riêng** `english_quiz_test` (`.env.test`), KHÔNG đụng DB dev. `test/setup.ts` từ chối chạy nếu `DATABASE_URL` không chứa chữ `test`.
- LLM luôn mock ở `generateStructuredOutput` — không bao giờ gọi OpenRouter thật. Redis mock in-memory, không chạy worker BullMQ.
- Viết test phải ưu tiên test tất cả các bussiness và user journey; đặt tên test theo khẳng định nghiệp vụ, không theo implementation.
- Phát hiện bug khi viết test: ghi vào `test/notes/FINDINGS.md` + test khoá hiện trạng, không tự sửa logic.

## Agent Skills

Project skills in `.claude/skills/` (load the matching skill before changing a feature):

- Cross-cutting: `api-endpoint`, `bullmq-job`, `llm-generation`, `testing`, `api-contract-sync` (sync with english-quiz-dashboard)
- Domain: `question-pool` (includes the "add quiz type" checklist), `pool-review`, `sibling-question`, `reading-passage`, `reading-question`, `beginner`, `english-config`, `cron-tracking`, `topics`, `ai-model-provider`, `tenant-auth`, `admin-auth`

When you change a feature's files, wiring points or business rules, update the matching skill too (same as the docs rule).
