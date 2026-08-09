/**
 * Seed script: tạo (hoặc promote) tài khoản admin đầu tiên cho dashboard.
 * Chạy: bun --env-file=.env.local run src/core/db/seeds/admin-user.seed.ts
 *
 * Env:
 *   SEED_ADMIN_EMAIL     (bắt buộc)
 *   SEED_ADMIN_PASSWORD  (chỉ cần khi user chưa tồn tại; tối thiểu 12 ký tự)
 *   SEED_ADMIN_NAME      (mặc định "Admin")
 *
 * Hai trường hợp:
 *  - Email đã có user (vd vừa đăng nhập Google lần đầu) → chỉ set role = 'admin'.
 *  - Chưa có user → signUpEmail rồi set role = 'admin'.
 *
 * Signup mở nên mọi tài khoản mới đều là role 'user' (0 quyền). Script này là cách
 * duy nhất để có admin đầu tiên; admin sau đó tự tạo/promote người khác qua API.
 */
import { eq } from 'drizzle-orm';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';
import { auth, Role } from '@/configs/auth.config';
import { users } from '@/core/db/schema/auth';

async function seedAdminUser(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? 'Admin';

  if (!email) throw new Error('[Seed/Admin] Thiếu SEED_ADMIN_EMAIL');

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!existing) {
    if (!password) {
      throw new Error(`[Seed/Admin] User "${email}" chưa tồn tại — cần SEED_ADMIN_PASSWORD để tạo mới`);
    }
    // Đi qua auth.api để password được hash đúng chuẩn Better Auth (không insert tay).
    await auth.api.signUpEmail({ body: { email, password, name } });
    logger.info(`[Seed/Admin] Đã tạo user ${email}`);
  } else {
    logger.info(`[Seed/Admin] User ${email} đã tồn tại (role hiện tại: ${existing.role ?? 'null'})`);
  }

  const [promoted] = await db.transaction(async (tx) =>
    tx.update(users).set({ role: Role.ADMIN }).where(eq(users.email, email)).returning()
  );
  if (!promoted) throw new Error(`[Seed/Admin] Không promote được user ${email}`);

  logger.info('[Seed/Admin] ─────────────────────────────────────────────');
  logger.info(`[Seed/Admin] Admin sẵn sàng: ${promoted.email} (id=${promoted.id}, role=${promoted.role})`);
  logger.info('[Seed/Admin] Đăng nhập ở dashboard, hoặc lấy token bằng:');
  logger.info(
    `[Seed/Admin]   curl -i -X POST $BETTER_AUTH_URL/api/auth/sign-in/email -H 'content-type: application/json' -d '{"email":"${email}","password":"***"}'`
  );
  logger.info('[Seed/Admin] Token nằm ở response header `set-auth-token`.');
  logger.info('[Seed/Admin] ─────────────────────────────────────────────');
}

seedAdminUser()
  .then(() => {
    logger.info('[Seed/Admin] Done.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('[Seed/Admin] Failed:', err);
    process.exit(1);
  });
