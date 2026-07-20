import { drizzle } from 'drizzle-orm/node-postgres';
import type { Logger } from 'drizzle-orm';
import logger from './logger.config';

class AppLogger implements Logger {
  logQuery(message: string): void {
    logger.info(message);
  }
}

const db = drizzle({
  logger: process.env.NODE_ENV === 'development' ? new AppLogger() : undefined,
  connection: {
    connectionString: process.env.DATABASE_URL as string
  }
});

export default db;
