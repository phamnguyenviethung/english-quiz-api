import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
dotenv.config({
  path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local'
});

export default defineConfig({
  schema: './src/core/db/schema/main.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL as string
  },
  strict: true
});
