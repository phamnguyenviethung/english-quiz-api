# Tenant Auth — Multi-tenant API-key Authentication & Authorization

> Mục đích: mô tả cơ chế xác thực tenant qua API key Bearer và phân quyền truy cập resource quiz (topic, quizType). Cập nhật doc này khi sửa auth flow hoặc grant model.

## 1. Tổng Quan

Mỗi client (bot/server) là một **tenant**. Tenant xác thực mỗi request bằng **API key Bearer** và chỉ được **đọc quiz** — sinh câu hỏi, lấy câu từ pool, đọc danh sách chủ đề/dạng quiz. Tenant không tự sửa config, tạo topic, nạp pool hay xem cron — các việc đó dành cho dashboard quản trị (`ADMIN_API_KEY`). Trong phạm vi đọc quiz, tenant còn bị giới hạn thêm bởi:

- **Topic allow-list**: tenant được truy cập topic nào (hoặc `allowAllTopics`).
- **QuizType allow-list**: tenant được truy cập quizType nào (hoặc `allowAllQuizTypes`).

Data quiz (topic/pool/config) vẫn **global dùng chung** — không có cột `tenantId` trong bảng `english_*`. Tenant chỉ **giới hạn access**, không sở hữu data riêng.

```
Client ──Authorization: Bearer eqk_<random>──► /english/*
   │
   ├─ tenantAuth.resolve:
   │     ├─ key khớp ADMIN_API_KEY? → ADMIN_TENANT (full quyền, 0 query DB) ──┐
   │     └─ else: lookup key (plaintext) WHERE key = raw AND isActive          │
   │              → check tenant active → inject ctx.tenant                    │
   │                                                                           │
   ├─ macro auth: { admin } → route admin-only mà tenant không phải admin ◄────┤
   │                          → 403                                            │
   │                                                                           │
   └─ handler: assertTopicAllowed / assertQuizTypeAllowed → 403 nếu ngoài ◄────┘
                                                            allow-list
```

### Admin key là super key

`ADMIN_API_KEY` dùng được ở **mọi** endpoint, không riêng `/admin/*`. Khi request mang admin key, `tenantAuthPlugin` trả về `ADMIN_TENANT` — một `TenantContext` **ảo** (`src/api/plugins/tenantAuth.plugin.ts`) có `isAdmin: true` + `allowAllTopics` + `allowAllQuizTypes`, nên pass hết guard phía sau (kể cả endpoint admin-only) mà không cần query DB.

| Key gửi lên                                 | `/admin/*` | `/english/*`                           |
| ------------------------------------------- | ---------- | -------------------------------------- |
| `ADMIN_API_KEY` (Bearer hoặc `x-admin-key`) | ✅ full    | ✅ full — kể cả endpoint admin-only    |
| Tenant key `eqk_...` (Bearer)               | ❌ 401     | ✅ chỉ route đọc quiz, theo allow-list |
| Không có / sai                              | ❌ 401     | ❌ 401                                 |

Mục đích: dashboard quản trị chỉ cần cầm **1 secret** cho cả hai phía. Discord bot vẫn dùng tenant key giới hạn như cũ.

Lưu ý khi đọc code: `ADMIN_TENANT.id = 0` và `name = '__admin__'` **không ứng với row nào** trong bảng `tenants`. An toàn vì `tenantId` không xuống tới tầng data (data quiz là global). Phân biệt bằng cờ `TenantContext.isAdmin === true`.

## 2. File Chính

| File                                         | Vai trò                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/core/db/schema/main.ts`                 | Bảng `tenants`, `tenant_api_keys`, `tenant_topic_access`, `tenant_quiz_type_access`                                |
| `src/core/services/tenant/tenant.service.ts` | CRUD tenant, set allow-list, build `TenantContext`                                                                 |
| `src/core/services/tenant/apiKey.service.ts` | Generate/verify API key (plaintext lookup), issue/list/revoke                                                      |
| `src/api/plugins/tenantAuth.plugin.ts`       | Resolve tenant (+ `ADMIN_TENANT`) + macro `auth` (admin-only guard) + `assertTopicAllowed`/`assertQuizTypeAllowed` |
| `src/api/plugins/adminAuth.plugin.ts`        | Guard `/admin/*` bằng `ADMIN_API_KEY`                                                                              |
| `src/api/common/adminKey.ts`                 | Đọc + so khớp `ADMIN_API_KEY` (dùng chung 2 plugin trên)                                                           |
| `src/api/routes/admin.route.ts`              | Endpoint quản trị tenant/key/grant                                                                                 |
| `src/api/routes/english.route.ts`            | Áp guard `auth: true` (đọc quiz) / `auth: { admin: true }` (quản trị) + allow-list check                           |
| `src/api/common/errorHandler.ts`             | Map exception → HTTP status (401/403/404/400/409/500)                                                              |
| `src/core/exceptions/index.ts`               | `HttpException` + Unauthorized/Forbidden/NotFound/Conflict/BusinessLogic                                           |
| `src/core/db/seeds/tenant.seed.ts`           | Tạo tenant demo + API key để test (`bun run db:seed:tenant`)                                                       |

## 3. DB Schema

- **`tenants`**: `id`, `name` (unique), `description`, `isActive`, `allowAllTopics`, `allowAllQuizTypes`, timestamps.
- **`tenant_api_keys`**: `id`, `tenantId` → tenants, `key` (plaintext, unique, indexed), `label`, `isActive`, `lastUsedAt`, `revokedAt`, `createdAt`.
- **`tenant_topic_access`**: `(tenantId, topicId)` unique — allow-list topic.
- **`tenant_quiz_type_access`**: `(tenantId, quizType)` unique — allow-list quizType (validate bằng `isQuizType`).

## 4. API Key Format

- Format: `eqk_<48 hex random>`. Key **lưu plaintext** trong cột `key` (unique) — chưa cần hash.
- Verify: lookup trực tiếp `tenant_api_keys` `WHERE key = raw AND isActive` → check tenant active → build `TenantContext`. Không parse, không hash, không timing-safe compare.
- **Response issue key trả plaintext một lần** (`POST /admin/tenants/:id/keys`) cho nhất quán UX; list key thì ẩn cột `key`.
- Rotate/revoke: cấp key mới hoặc `DELETE /admin/tenants/:id/keys/:apiKeyId` (set `isActive=false`). Giới hạn theo `tenantId` — key không thuộc tenant đó trả 404.
- `lastUsedAt` được cập nhật có **throttle 5 phút** để tránh ghi DB mỗi request.

> Lưu ý bảo mật: key lưu plaintext nên ai đọc được DB sẽ thấy key. Nếu cần siết sau này, chuyển sang lưu `sha256(key)` + lookup theo hash (không đổi API bên ngoài).

## 5. Phân quyền

Tenant key chỉ đọc quiz. Có 2 tầng giới hạn:

1. **Admin-only trên `/english/*`**: các route quản trị (nạp pool, sửa config, tạo topic, xem cron) khai báo `auth: { admin: true }` — chỉ `ADMIN_API_KEY` gọi được, tenant key trả **403**. Các route còn lại (đọc quiz) chỉ cần `auth: true` — mọi tenant key hợp lệ dùng được.

   | Nhóm                           | Route                                                                                                                                                                               | Guard                   |
   | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
   | Đọc quiz (mọi tenant key)      | `/quiz-types`, `/generate/:quizType`, `/generate-reading`, `/pool/pop`, `/pool/count`, `/pool/questions`, `/pool/models`, `/pool/pick-quiz-type`, `/topics`, `/topics/random-pairs` | `auth: true`            |
   | Quản trị (chỉ `ADMIN_API_KEY`) | `POST /pool/fill`, `GET /config`, `GET /config/records`, `PATCH /config/:recordKey`, `POST /config/:recordKey/reset`, `POST /topics`, `GET /cron/runs`, `GET /cron/runs/:runId`     | `auth: { admin: true }` |

2. **Topic / quizType allow-list**: trong các route đọc quiz, tenant còn bị giới hạn theo `tenant_topic_access` / `tenant_quiz_type_access` (hoặc cờ `allowAllTopics` / `allowAllQuizTypes`) — xem [`question-pool.md`](./question-pool.md) và mục 6 bên dưới.

## 6. Enforcement

- **Mọi `/english/*` yêu cầu Bearer API key hợp lệ** (`tenantAuthPlugin`). Thiếu/sai key → **401**. Gọi route admin-only bằng tenant key → **403**. Topic/quizType ngoài allow-list → **403**.
- `ADMIN_API_KEY` được check **trước** tenant lookup (string compare rẻ hơn 3 round-trip DB) và bỏ qua toàn bộ check admin-only/allow-list. Key không khớp thì rơi xuống nhánh tenant bình thường.
- `/health` mở (không auth). `/queues` (bull-board) hiện để mở — có thể bọc `adminAuthPlugin` ở phase sau.
- `topicId = null` (bucket no-topic) luôn được phép truy cập.

### Response envelope

Mọi response dùng envelope thống nhất (`src/api/common/response.ts`):

```jsonc
// Success
{ "success": true, "data": ... }
// List (thêm total)
{ "success": true, "data": [...], "total": 3 }
// Error — luôn có error.code máy đọc được
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

`error.code` ∈ `VALIDATION` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `BUSINESS_ERROR` (400), `INTERNAL_ERROR` (500). Client nên nhánh theo `code` (ổn định), không dựa vào `message`.

## 7. Admin API (`/admin/*`)

Yêu cầu header `x-admin-key: <ADMIN_API_KEY>` (hoặc `Authorization: Bearer <ADMIN_API_KEY>`). Cùng key này dùng luôn được cho `/english/*` — xem [Admin key là super key](#admin-key-là-super-key).

| Method & Path                              | Mô tả                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `POST /admin/tenants`                      | Tạo tenant `{ name, description?, allowAllTopics?, allowAllQuizTypes? }` → **201**                |
| `GET /admin/tenants`                       | List tenant                                                                                       |
| `GET /admin/tenants/:id`                   | Chi tiết tenant                                                                                   |
| `PATCH /admin/tenants/:id`                 | Update tenant (name/description/allowAll\*/isActive). Soft-deactivate = gửi `{ isActive: false }` |
| `POST /admin/tenants/:id/keys`             | Cấp API key mới (**response chứa plaintext — lưu ngay**) → **201**                                |
| `GET /admin/tenants/:id/keys`              | List key (ẩn cột `key`)                                                                           |
| `DELETE /admin/tenants/:id/keys/:apiKeyId` | Thu hồi key (set `isActive=false`). Key không thuộc tenant `:id` → 404                            |
| `GET /admin/tenants/:id/topics`            | Allow-list topic hiện tại `{ tenantId, topicIds }`                                                |
| `PUT /admin/tenants/:id/topics`            | Set allow-list topic `{ topicIds: number[] }` (replace)                                           |
| `GET /admin/tenants/:id/quiz-types`        | Allow-list quizType hiện tại `{ tenantId, quizTypes }`                                            |
| `PUT /admin/tenants/:id/quiz-types`        | Set allow-list quizType `{ quizTypes: string[] }` (replace)                                       |

## 8. Env & Boot

- `ADMIN_API_KEY` (bắt buộc) — secret bảo vệ `/admin/*` **và** là super key cho `/english/*`. `src/index.ts` gọi `checkEnv(['DATABASE_URL', 'REDIS_URL', 'ADMIN_API_KEY'])` → fail fast nếu thiếu.

> Vì key này giờ mở được toàn bộ API (kể cả các endpoint tốn LLM token), dùng chuỗi random đủ dài ở môi trường thật — đừng để giá trị placeholder như trong `.env.example`.

## 9. Setup & Test nhanh

```bash
# 1. Migration
bun run db:generate && bun run db:migrate

# 2. Seed tenant demo + API key (in plaintext key ra console)
bun run db:seed:tenant

# 3. Test (thay <KEY> = plaintext từ bước 2, <ADMIN> = ADMIN_API_KEY)
curl localhost:3399/health                                          # 200 (mở)
curl localhost:3399/english/quiz-types                              # 401 (thiếu key)
curl -H "Authorization: Bearer <KEY>" localhost:3399/english/quiz-types   # 200
curl -H "x-admin-key: <ADMIN>" localhost:3399/admin/tenants         # 200

# Admin key làm super key trên /english/* (cả 2 header đều được), kể cả route admin-only
curl -H "x-admin-key: <ADMIN>" localhost:3399/english/quiz-types            # 200
curl -H "Authorization: Bearer <ADMIN>" localhost:3399/english/topics       # 200
curl -H "x-admin-key: <ADMIN>" localhost:3399/english/config                # 200

# Tenant key đọc quiz được nhưng KHÔNG leo thang lên admin hay endpoint admin-only
curl -H "Authorization: Bearer <KEY>" localhost:3399/admin/tenants  # 401
curl -H "Authorization: Bearer <KEY>" localhost:3399/english/config # 403
```

## 10. Out of scope (phase sau)

- JWT / session-based auth (hiện chỉ API key server-to-server).
- Rate limiting per-tenant.
- Guard cho `/queues` (bull-board).
- Per-tenant config override (config hiện global).
