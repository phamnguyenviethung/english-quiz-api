---
name: admin-auth
description: Admin authentication in english-quiz-api with Better Auth — email/password + Google, bearer session token, role admin guard on /admin/* and /queues, reset password mail via Resend, admin seed, generated auth schema. Use when touching auth.config.ts, adminAuth.plugin.ts, schema/auth.ts, resetPassword.mail.ts or admin user management.
---

# Admin auth

Full spec: `docs/admin-auth.md`. Generic Better Auth guidance: the `better-auth-best-practices` / `better-auth-security-best-practices` skills.

## Rules
- Only `users.role = "admin"` passes the guard (`Role` in `src/configs/auth.config.ts`). Sessions live in Postgres → revocation is immediate (`getSession`, not JWT).
- Clients send the session token as `Authorization: Bearer <token>` (from the `set-auth-token` header; `bearer()` plugin). Dashboard relies on this.
- `/admin/*`: `adminAuthPlugin` resolves `user` (401 without session, 403 non-admin). `/queues` (Bull Board) has a global admin guard in `src/api/api.ts`. On `/english/*` an admin session acts as the super tenant (see `tenant-auth`).
- Reset password always returns 200 with a generic message (no account enumeration); mail via Resend (`src/configs/mail.config.ts`).
- Password min length 12.

## File map
| Concern | Path |
|---|---|
| Better Auth config | `src/configs/auth.config.ts` (`auth`, `Role`, `trustedOrigins`, plugins `admin`, `bearer`, `oauthPopup`, `openAPI`) |
| Guard | `src/api/plugins/adminAuth.plugin.ts` (`adminAuthPlugin`, `resolveAdminUser`, `getAdminUser`) |
| Mount | `.mount(auth.handler)` in `src/api/api.ts` (`/api/auth/*`) |
| Schema | `src/core/db/schema/auth.ts` — **generated**, regenerate with `bun run auth:generate`, don't hand-edit |
| Mail | `src/core/services/mail/resetPassword.mail.ts` |
| Seed | `src/core/db/seeds/admin-user.seed.ts` (`bun run db:seed:admin`, env `SEED_ADMIN_*`) |

## Gotchas
- `.mount(auth.handler)` without prefix makes unknown routes return an empty-body 404 (`test/notes/FINDINGS.md` #1).
- Changing plugins/fields → regenerate auth schema (docs §8), no SQL migration files.

## Tests
E2E `j8-auth-errors`, `j2-tenant-permission`. Helpers `createAdminUser`, `createNormalUser`, `banUser` in `test/helpers/auth.helper.ts`.
