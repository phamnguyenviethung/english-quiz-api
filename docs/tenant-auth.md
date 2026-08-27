# Tenant Auth — Multi-tenant API-key Authentication & Authorization

> Mục đích: mô tả cơ chế xác thực tenant qua API key Bearer và phân quyền truy cập resource quiz (topic, quizType). Cập nhật doc này khi sửa auth flow hoặc grant model.

## 1. Tổng Quan

> Phía quản trị (đăng nhập admin bằng Better Auth) nằm ở [`admin-auth.md`](./admin-auth.md).

Mỗi client (bot/server) là một **tenant**. Tenant xác thực mỗi request bằng **API key Bearer** và chỉ được **đọc quiz** — sinh câu hỏi, lấy câu từ pool, đọc danh sách chủ đề/dạng quiz. Tenant không tự sửa config, tạo topic, nạp pool hay xem cron — các việc đó dành cho **tài khoản admin** của dashboard. Trong phạm vi đọc quiz, tenant còn bị giới hạn thêm bởi:

- **Topic allow-list**: tenant được truy cập topic nào (hoặc `allowAllTopics`).
- **QuizType allow-list**: tenant được truy cập quizType nào (hoặc `allowAllQuizTypes`).

Data quiz (topic/pool/config) vẫn **global dùng chung** — không có cột `tenantId` trong bảng `english_*`. Tenant chỉ **giới hạn access**, không sở hữu data riêng.

```
Client ──Authorization: Bearer eqk_<random>──► /english/*
   │
   ├─ tenantAuth.resolve:
   │     ├─ token có prefix `eqk_`? → lookup key (plaintext)                   │
   │     │       WHERE key = raw AND isActive → check tenant active            │
   │     │       → inject ctx.tenant                                           │
   │     └─ else: auth.api.getSession → session role admin?                    │
   │              → ADMIN_TENANT (full quyền) ────────────────────────────────┐
   │                                                                           │
   ├─ macro auth: { admin } → route admin-only mà tenant không phải admin ◄────┤
   │                          → 403                                            │
   │                                                                           │
   └─ handler: assertTopicAllowed / assertQuizTypeAllowed → 403 nếu ngoài ◄────┘
                                                            allow-list
```

### Session admin là super key

Tài khoản `role = "admin"` (Better Auth) dùng được ở **mọi** endpoint, không riêng `/admin/*`. Khi request mang session admin, `tenantAuthPlugin` trả về `ADMIN_TENANT` — một `TenantContext` **ảo** (`src/api/plugins/tenantAuth.plugin.ts`) có `isAdmin: true` + `allowAllTopics` + `allowAllQuizTypes`, nên pass hết guard phía sau (kể cả endpoint admin-only).

| Gửi lên                                          | `/admin/*` | `/english/*`                           |
| ------------------------------------------------ | ---------- | -------------------------------------- |
| Session admin (Bearer session token hoặc cookie) | ✅ full    | ✅ full — kể cả endpoint admin-only    |
| Tenant key `eqk_...` (Bearer)                    | ❌ 401     | ✅ chỉ route đọc quiz, theo allow-list |
| Session `role = "user"`                          | ❌ 403     | ❌ 401                                 |
| Không có / sai                                   | ❌ 401     | ❌ 401                                 |

Mục đích: admin đăng nhập **một lần** là dùng được cả hai phía, không cần cấp tenant key riêng cho dashboard. Discord bot vẫn dùng tenant key giới hạn như cũ.

Hai loại token đi chung header `Authorization: Bearer` và được phân biệt bằng **prefix `eqk_`** — nhờ vậy request của bot không phải trả thêm một lượt query session.

Lưu ý khi đọc code: `ADMIN_TENANT.id = 0` và `name = '__admin__'` **không ứng với row nào** trong bảng `tenants`. An toàn vì `tenantId` không xuống tới tầng data (data quiz là global). Phân biệt bằng cờ `TenantContext.isAdmin === true`.

## 2. File Chính

| File                                         | Vai trò                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/core/db/schema/main.ts`                 | Bảng `tenants`, `tenant_api_keys`, `tenant_topic_access`, `tenant_quiz_type_access`                                |
| `src/core/services/tenant/tenant.service.ts` | CRUD tenant, set allow-list, build `TenantContext`                                                                 |
| `src/core/services/tenant/apiKey.service.ts` | Generate/verify API key (plaintext lookup), issue/list/revoke                                                      |
| `src/api/plugins/tenantAuth.plugin.ts`       | Resolve tenant (+ `ADMIN_TENANT`) + macro `auth` (admin-only guard) + `assertTopicAllowed`/`assertQuizTypeAllowed` |
| `src/api/plugins/adminAuth.plugin.ts`        | Guard `/admin/*` bằng session admin; export `getAdminUser` dùng chung — xem [`admin-auth.md`](./admin-auth.md)     |
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

1. **Admin-only trên `/english/*`**: các route quản trị (nạp pool, sửa config, tạo topic, xem cron) khai báo `auth: { admin: true }` — chỉ session admin gọi được, tenant key trả **403**. Các route còn lại (đọc quiz) chỉ cần `auth: true` — mọi tenant key hợp lệ dùng được.

   | Nhóm                         | Route                                                                                                                                                                               | Guard                   |
   | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
   | Đọc quiz (mọi tenant key)    | `/quiz-types`, `/generate/:quizType`, `/generate-reading`, `/pool/pop`, `/pool/count`, `/pool/questions`, `/pool/models`, `/pool/pick-quiz-type`, `/topics`, `/topics/random-pairs` | `auth: true`            |
   | Quản trị (chỉ session admin) | `POST /pool/fill`, `GET /config`, `GET /config/records`, `PATCH /config/:recordKey`, `POST /config/:recordKey/reset`, `POST /topics`, `GET /cron/runs`, `GET /cron/runs/:runId`     | `auth: { admin: true }` |

2. **Topic / quizType allow-list**: trong các route đọc quiz, tenant còn bị giới hạn theo `tenant_topic_access` / `tenant_quiz_type_access` (hoặc cờ `allowAllTopics` / `allowAllQuizTypes`) — xem [`question-pool.md`](./question-pool.md) và mục 6 bên dưới. `/topics` và `/topics/random-pairs` không nhận `auth: { admin: true }` nên vẫn dùng được với mọi tenant key, nhưng **kết quả trả về bị lọc** theo allow-list: tenant giới hạn chỉ thấy/nhận được topic nằm trong `tenant_topic_access` (hoặc rỗng nếu allow-list rỗng), không lộ topic ngoài phạm vi.

## 6. Enforcement

- **Mọi `/english/*` yêu cầu tenant key hợp lệ hoặc session admin** (`tenantAuthPlugin`). Thiếu/sai → **401**. Gọi route admin-only bằng tenant key → **403**. Topic/quizType ngoài allow-list → **403** ở các route nhận `topicId`/`quizType` cụ thể (`assertTopicAllowed`/`assertQuizTypeAllowed`); riêng `/topics` và `/topics/random-pairs` không có `topicId` đơn lẻ để assert nên **lọc kết quả** theo allow-list thay vì trả 403.
- Token có prefix `eqk_` đi thẳng nhánh tenant lookup; token khác được coi là session token của Better Auth. Session admin bỏ qua toàn bộ check admin-only/allow-list.
- `/health` mở (không auth). `/queues` (bull-board) yêu cầu **cookie phiên admin** — check ở hook global trong `src/api/api.ts`.
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

Yêu cầu tài khoản `role = "admin"`: `Authorization: Bearer <session token>` hoặc cookie phiên đăng nhập. Cùng phiên đó dùng luôn được cho `/english/*` — xem [Session admin là super key](#session-admin-là-super-key) và [`admin-auth.md`](./admin-auth.md).

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
| `POST /admin/models`                       | Tạo AI model → **201**, `key`/`modelId` unique, tự nạp giá từ OpenRouter catalog                  |
| `GET /admin/models`                        | List AI model (bảng `ai_models`, nguồn chọn model sinh câu hỏi)                                   |
| `GET /admin/models/catalog?search=`        | Duyệt catalog model thật của OpenRouter kèm giá (cache 5 phút) — chọn trước khi thêm              |
| `GET /admin/models/:id`                    | Chi tiết AI model                                                                                 |
| `PATCH /admin/models/:id`                  | Update AI model. Soft-deactivate = gửi `{ isActive: false }`                                      |
| `POST /admin/models/:id/sync`              | Nạp lại giá + metadata từ catalog cho 1 model (404 nếu model không có trên catalog)               |
| `POST /admin/models/sync-all`              | Nạp lại giá cho toàn bộ model → `{ synced, notFound[] }`                                          |

Body của `POST`/`PATCH /admin/models` ngoài `key`/`modelId`/`isActive` còn nhận:

| Field                                 | Ý nghĩa                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scheduleEnabled` / `manualEnabled`   | Model có nằm trong pool chọn ngẫu nhiên của context tự động / admin-trigger (mặc định `true`)                                                                                                          |
| `scheduleProvider` / `manualProvider` | `ProviderPreferences` của OpenRouter (`order`, `only`, `ignore`, `sort`, `maxPrice`, `quantizations`, `dataCollection`, `zdr`, …) — pass thẳng vào request, cho phép cấu hình khác nhau giữa 2 context |

Giá (`pricePromptPerToken`, `priceCompletionPerToken`) chỉ đọc — nạp từ catalog, không nhập tay. Chi tiết cách chọn model xem `docs/question-pool.md` § "Chọn model & provider routing".

## 8. Env & Boot

Phía tenant không cần env riêng — key nằm trong DB. Env của phía admin (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, …) xem [`admin-auth.md`](./admin-auth.md) § Env.

## 9. Setup & Test nhanh

```bash
# 1. Migration + admin đầu tiên
bun run db:generate && bun run db:migrate
bun run db:seed:admin

# 2. Seed tenant demo + API key (in plaintext key ra console)
bun run db:seed:tenant

# 3. Test (<KEY> = plaintext từ bước 2, <TOKEN> = set-auth-token khi đăng nhập)
curl localhost:3399/health                                                # 200 (mở)
curl localhost:3399/english/quiz-types                                    # 401 (thiếu key)
curl -H "Authorization: Bearer <KEY>" localhost:3399/english/quiz-types   # 200

# Session admin làm super key trên cả /admin/* lẫn /english/*, kể cả route admin-only
curl -H "Authorization: Bearer <TOKEN>" localhost:3399/admin/tenants      # 200
curl -H "Authorization: Bearer <TOKEN>" localhost:3399/english/topics     # 200
curl -H "Authorization: Bearer <TOKEN>" localhost:3399/english/config     # 200

# Tenant key đọc quiz được nhưng KHÔNG leo thang lên admin hay endpoint admin-only
curl -H "Authorization: Bearer <KEY>" localhost:3399/admin/tenants  # 401
curl -H "Authorization: Bearer <KEY>" localhost:3399/english/config # 403
```

## 10. Out of scope (phase sau)

- Hash tenant key trong DB (hiện lưu plaintext).
- Rate limiting per-tenant.
- Per-tenant config override (config hiện global).
