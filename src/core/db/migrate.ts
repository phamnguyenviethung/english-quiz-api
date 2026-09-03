import { migrate } from 'drizzle-orm/node-postgres/migrator';
import db from '@/configs/orm.config';
import logger from '@/configs/logger.config';

/**
 * Run database migrations
 */
export async function runMigrations() {
  try {
    logger.info('Running database migrations...');

    await migrate(db, {
      migrationsFolder: './drizzle'
    });

    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

// Chỉ tự chạy khi được gọi trực tiếp (bun run src/core/db/migrate.ts). Import từ nơi khác
// (vd harness test dựng schema cho DB test) thì chỉ lấy hàm, không exit process.
if (import.meta.main) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
