# Admin Auth — Better Auth (session + role)

> Mục đích: mô tả cơ chế xác thực **người quản trị** bằng Better Auth (Drizzle + PostgreSQL) — thay cho `ADMIN_API_KEY` cũ. Cập nhật doc này khi sửa config auth, guard, hoặc thêm/bớt plugin.

## 1. Tổng quan

Trước đây `/admin/*` được bảo vệ bằng **một secret tĩnh** `ADMIN_API_KEY`. Secret đó bị bake vào bundle browser của dashboard, không có danh tính, và không revoke được từng người. Nay thay bằng **tài khoản thật**:

- Đăng nhập bằng **email/password** hoặc **Google OAuth**.
- Session lưu trong Postgres (bảng `sessions`) → **revoke có hiệu lực ngay lập tức**.
- Phân quyền bằng cột `users.role`; **chỉ `role = "admin"`** mới qua được guard.

Tenant API key (`eqk_...`) **không đổi** — Discord bot vẫn dùng như cũ, xem [`tenant-auth.md`](./tenant-auth.md).

```
Dashboard ──POST /api/auth/sign-in/email──► Better Auth handler
    │                                          └─ set-auth-token: <session token>
    │
    └──Authorization: Bearer <session token>──► /admin/*, /english/*, /queues
           │
           └─ auth.api.getSession(headers)   ← đọc được CẢ cookie lẫn Bearer
                 ├─ không có session        → 401
                 ├─ user.banned             → 403
                 ├─ role !== 'admin'        → 403
                 └─ ok → ctx.user / ADMIN_TENANT
```

### Vì sao `getSession` chứ không phải JWT/JWKS

Guard gọi thẳng `auth.api.getSession({ headers })` (query bảng `sessions`) thay vì verify JWT qua JWKS:

- Sign-out / revoke session có hiệu lực **ngay**, không phải đợi token hết hạn.
- Không phải tự gọi HTTP vào chính service để lấy JWKS.
- Đổi lại: mỗi request admin tốn 1 lượt query session. Traffic bot (`eqk_` key) **không** dính chi phí này — xem mục 4.

## 2. File chính

| File                                           | Vai trò                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/configs/auth.config.ts`                   | Khởi tạo `betterAuth` + plugin, export `auth`, `Role`, `trustedOrigins`         |
| `src/core/db/schema/auth.ts`                   | Schema Drizzle sinh bởi CLI (`users`, `sessions`, `accounts`, `verifications`)  |
| `src/api/plugins/adminAuth.plugin.ts`          | Guard `/admin/*` (`resolveAdminUser`) + helper `getAdminUser` dùng chung        |
| `src/api/plugins/tenantAuth.plugin.ts`         | `/english/*`: tenant key **hoặc** session admin → `ADMIN_TENANT`                |
| `src/api/api.ts`                               | `.mount(auth.handler)`, CORS (`credentials` + `exposeHeaders`), guard `/queues` |
| `src/core/db/seeds/admin-user.seed.ts`         | Tạo/promote admin đầu tiên (`bun run db:seed:admin`)                            |
| `src/configs/mail.config.ts`                   | Client Resend + `sendMail`; thiếu env thì tắt gửi mail chứ không chặn boot      |
| `src/core/services/mail/resetPassword.mail.ts` | Nội dung mail đặt lại mật khẩu (HTML + text)                                    |

## 3. Cấu hình

Plugin đang bật (`src/configs/auth.config.ts`):

| Plugin         | Dùng để làm gì                                                                               |
| -------------- | -------------------------------------------------------------------------------------------- |
| `admin()`      | Cột `role`/`banned`/`banReason`/`banExpires`; `defaultRole: 'user'`, `adminRoles: ['admin']` |
| `bearer()`     | Nhận session token qua `Authorization: Bearer`, trả token qua header `set-auth-token`        |
| `oauthPopup()` | Google sign-in bằng popup, `postMessage` session token về opener (SPA lấy được bearer token) |
| `openAPI()`    | Spec OpenAPI của Better Auth, expose ở `GET /openapi-auth`                                   |

Điểm cần lưu ý:

- **Không** bật `disableCSRFCheck` / `disableOriginCheck`. Origin hợp lệ khai qua `TRUSTED_ORIGINS`.
- `AUTH_COOKIE_DOMAIN` bật `crossSubDomainCookies` — cần khi dashboard và API ở 2 subdomain cùng root (vd `admin.abc.com` + `api.abc.com`), nhờ đó đăng nhập ở dashboard xong mở `/queues` là có session.
- CORS **bắt buộc** có `exposeHeaders: ['set-auth-token']`, không thì SPA không đọc được token sau khi đăng nhập.
- Google chỉ bật khi có đủ `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`; thiếu thì log warn và chỉ mất nút Google.

## 4. Phân quyền & thứ tự resolve

| Request                                       | `/admin/*` | `/english/*`                     | `/queues` |
| --------------------------------------------- | ---------- | -------------------------------- | --------- |
| Session `role = "admin"` (Bearer hoặc cookie) | ✅ full    | ✅ full — kể cả route admin-only | ✅        |
| Session `role = "user"`                       | ❌ 403     | ❌ 401                           | ❌ 401    |
| Tenant key `eqk_...`                          | ❌ 401     | ✅ đọc quiz, theo allow-list     | ❌ 401    |
| Không có gì                                   | ❌ 401     | ❌ 401                           | ❌ 401    |

`tenantAuthPlugin` phân biệt 2 loại token trong cùng header `Authorization: Bearer` bằng **prefix**:

1. Bắt đầu bằng `eqk_` → đi nhánh tenant key (`apiKeyService.verifyKey`).
2. Ngược lại → `auth.api.getSession`; có session admin thì trả `ADMIN_TENANT` (full quyền, bỏ qua allow-list).
3. Không khớp gì → 401.

Nhờ prefix, traffic của bot không phải trả thêm một lượt query session cho mỗi request.

## 5. Tài khoản & role

Signup đang **mở** (email/password và Google). Người mới đăng ký nhận `role = "user"` — **không có quyền gì** trên API này: `/admin/*` trả 403, `/english/*` và `/queues` trả 401. Quyền admin chỉ có được khi cột `users.role` được set thành `admin`.

Admin đầu tiên tạo bằng seed script:

```bash
# .env.local: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (min 12 ký tự), SEED_ADMIN_NAME
bun run db:seed:admin
```

- Email chưa có user → tạo mới rồi set role `admin`.
- Email đã có user (vd vừa đăng nhập Google lần đầu) → chỉ promote role, không cần password.

Sau đó admin quản lý người khác qua các endpoint của plugin `admin()` (`/api/auth/admin/*`): `create-user`, `set-role`, `ban-user`, `list-users`, `revoke-user-sessions`, …

## 6. Reset password

Tự phục hồi mật khẩu qua email, dùng thẳng endpoint có sẵn của Better Auth — phần bổ sung của repo chỉ là mail provider (Resend).

```
Dashboard /forgot-password
  └─ authClient.requestPasswordReset({ email, redirectTo: `${origin}/reset-password` })
       │  originCheck(redirectTo) → redirectTo BẮT BUỘC nằm trong TRUSTED_ORIGINS
       ▼
POST /api/auth/request-password-reset
  ├─ email không tồn tại → vẫn trả message generic (chống dò email), không gửi mail
  ├─ tạo verification `reset-password:<token>` (hạn 15 phút)
  └─ sendResetPassword({ user, url }) → sendResetPasswordEmail → Resend
        url = <BETTER_AUTH_URL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>
       ▼
User bấm link → GET /api/auth/reset-password/:token?callbackURL=...
  ├─ token sai/hết hạn → redirect <callbackURL>?error=INVALID_TOKEN
  └─ token hợp lệ      → redirect <callbackURL>?token=<token>
       ▼
Dashboard /reset-password?token=...
  └─ authClient.resetPassword({ newPassword, token })
```

Điểm cần lưu ý:

- Token **hạn 15 phút**, **dùng một lần** (`consumeVerificationValue`). Reset xong `revokeSessionsOnPasswordReset` thu hồi **toàn bộ** phiên cũ của user đó.
- `redirectTo` phải nằm trong `TRUSTED_ORIGINS`, nếu không `originCheck` chặn ngay ở bước đầu.
- Mật khẩu mới tối thiểu **12 ký tự** (`minPasswordLength`) — validate cả ở client lẫn server.
- User đăng nhập bằng Google (chưa có account `credential`) **vẫn reset được**: Better Auth tự tạo account `credential` cho họ, tức là có thêm đường đăng nhập bằng mật khẩu.
- Rate limit riêng, chặt hơn mức chung: `/request-password-reset` 3 lần/60s, `/reset-password` 5 lần/60s.
- ⚠️ Better Auth gọi `sendResetPassword` qua `runInBackgroundOrAwait` — hàm này **nuốt exception**, chỉ log lại. Mail gửi lỗi thì endpoint **vẫn trả 200**. Vì vậy `sendMail` phải `logger.error` đủ chi tiết; đó là tín hiệu duy nhất, và Discord transport (mức `warn`) sẽ đẩy log này về kênh log.

## 7. Env

| Biến                                                           | Bắt buộc | Ghi chú                                                                |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                           | ✅       | Min 32 ký tự. `openssl rand -base64 32`                                |
| `BETTER_AUTH_URL`                                              | ✅       | Origin công khai của API — dùng cho OAuth callback                     |
| `TRUSTED_ORIGINS`                                              | —        | CSV origin được phép gọi API (CORS + CSRF). Phải chứa origin dashboard |
| `AUTH_COOKIE_DOMAIN`                                           | —        | vd `.abc.com` để dùng chung cookie giữa subdomain                      |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                    | —        | Thiếu thì tắt Google sign-in                                           |
| `RESEND_API_KEY`                                               | —        | Thiếu thì tắt reset password (boot vẫn chạy, chỉ log warn)             |
| `MAIL_FROM`                                                    | —        | vd `English Quiz <noreply@abc.com>`. Thiếu thì tắt reset password      |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | —        | Chỉ dùng cho `db:seed:admin`                                           |

`src/index.ts` gọi `checkEnv(['DATABASE_URL', 'REDIS_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'])` → fail fast lúc boot.

Redirect URI cần khai ở Google Cloud Console: `<BETTER_AUTH_URL>/api/auth/callback/google`.

## 8. Đổi schema auth

Schema `src/core/db/schema/auth.ts` **do CLI sinh, không sửa tay**. Mỗi lần thêm/bớt plugin trong `auth.config.ts`:

```bash
bun run auth:generate    # sinh lại src/core/db/schema/auth.ts
bun run db:generate      # sinh migration SQL
bun run db:migrate
```

`drizzle.config.ts` khai cả 2 file schema (`main.ts` + `auth.ts`).

## 9. Test nhanh

```bash
# 0. Chuẩn bị
bun run db:generate && bun run db:migrate
bun run db:seed:admin

# 1. Đăng nhập — token nằm ở header `set-auth-token`
curl -i -X POST localhost:3399/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local.test","password":"..."}'
TOKEN=<set-auth-token>

# 2. Session admin dùng được ở cả /admin/* lẫn /english/*
curl -H "Authorization: Bearer $TOKEN" localhost:3399/admin/tenants     # 200
curl -H "Authorization: Bearer $TOKEN" localhost:3399/english/config    # 200

# 3. Không có session
curl -i localhost:3399/admin/tenants                                    # 401
curl -i localhost:3399/queues                                           # 401

# 4. Revoke có hiệu lực ngay
curl -X POST -H "Authorization: Bearer $TOKEN" localhost:3399/api/auth/sign-out
curl -i -H "Authorization: Bearer $TOKEN" localhost:3399/admin/tenants  # 401

# 5. Reset password — luôn 200 kèm message generic, xem log để biết mail đi hay không
curl -i -X POST localhost:3399/api/auth/request-password-reset \
  -H 'content-type: application/json' -H 'origin: http://localhost:5542' \
  -d '{"email":"admin@local.test","redirectTo":"http://localhost:5542/reset-password"}'

# Lấy token từ link trong mail rồi đặt mật khẩu mới (min 12 ký tự)
curl -i -X POST localhost:3399/api/auth/reset-password \
  -H 'content-type: application/json' \
  -d '{"token":"<token>","newPassword":"<mat-khau-moi>"}'
```

`/queues` (Bull Board) là UI trình duyệt nên chạy bằng **cookie**: đăng nhập ở dashboard rồi mở `/queues` trong cùng trình duyệt.

## 10. Ngoài phạm vi

- Email verification (`requireEmailVerification: false` — quyền admin đến từ cột `role`, không từ email đã verify).
- Đóng signup hoặc allow-list domain email.
- Access control chi tiết theo permission (hiện chỉ 2 role: `admin` / `user`).
- Rate limiting per-tenant (rate limit của Better Auth chỉ áp cho `/api/auth/*`, lưu in-memory theo process).
