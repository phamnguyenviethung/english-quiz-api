import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer, oauthPopup, openAPI } from 'better-auth/plugins';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import * as authSchema from '@/core/db/schema/auth';

/**
 * Better Auth — xác thực người dùng quản trị (thay cho ADMIN_API_KEY cũ).
 *
 * - Session lưu trong Postgres qua Drizzle → revoke có hiệu lực ngay.
 * - Plugin `bearer` cho phép dashboard gửi session token qua `Authorization: Bearer`;
 *   browser UI (Bull Board, Swagger) vẫn dùng cookie. `auth.api.getSession` đọc được cả hai.
 * - Plugin `oauthPopup` cho phép đăng nhập Google bằng popup và trả session token
 *   về opener — nhờ vậy SPA lấy được bearer token mà không cần redirect handoff.
 *
 * Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL (Better Auth tự đọc từ process.env).
 */

export const Role = {
  ADMIN: 'admin',
  USER: 'user'
} as const;

export type Role = (typeof Role)[keyof typeof Role];

// Origin được phép gọi API (CSRF whitelist của Better Auth + CORS của Elysia).
export const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Bật Google chỉ khi có đủ credential — thiếu env thì service vẫn boot, chỉ mất nút
// "đăng nhập bằng Google" (email/password vẫn chạy).
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleEnabled = Boolean(googleClientId && googleClientSecret);
if (!googleEnabled) {
  logger.warn('[Auth] Thiếu GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — Google sign-in bị tắt');
}

// Dashboard và API nằm cùng root domain (vd admin.abc.com + api.abc.com) nên cookie
// set ở scope `.abc.com` dùng chung được — cần cho Bull Board (/queues) sau khi đăng
// nhập từ dashboard. Không set env này thì cookie chỉ có hiệu lực trên host của API.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN;

export const auth = betterAuth({
  appName: 'english-quiz-api',
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: authSchema
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // Chưa có mail provider nên không bắt verify email. Quyền admin không đến từ
    // email đã verify mà từ cột `role` (chỉ promote thủ công/seed).
    requireEmailVerification: false
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: googleClientId as string,
          clientSecret: googleClientSecret as string
        }
      }
    : {},
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    ...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {})
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30
  },
  plugins: [admin({ defaultRole: Role.USER, adminRoles: [Role.ADMIN] }), bearer(), oauthPopup(), openAPI()]
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession['user'];

export const generateAuthOpenAPISchema = async (): Promise<unknown> => auth.api.generateOpenAPISchema();
