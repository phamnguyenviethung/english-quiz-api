# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# English Quiz API

**Quiz Infra** — service hạ tầng quản lý quiz tiếng Anh qua HTTP API: sinh câu hỏi bằng LLM, question pool (pre-generate), config runtime, topic, và cron tracking.

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

- Folder: `/docs/**` — tham khảo `question-pool.md`, `reading-passage.md`, `reading-question.md`, `english-config.md`, `generate-question-common-rule.md`, `ai-model-provider.md`, `admin-auth.md`, `tenant-auth.md`. Update docs khi sửa feature tương ứng.
