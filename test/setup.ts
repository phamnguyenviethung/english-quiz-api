import { mock } from 'bun:test';
import { invokeMockedStructuredOutput } from './helpers/llm.helper';

/**
 * Preload của `bun test` (khai trong bunfig.toml). Chạy TRƯỚC mọi import của test và của
 * src, nên là chỗ duy nhất mock được các module tạo kết nối ngay lúc import:
 *   - logger.config.ts  -> khởi tạo DiscordTransport vô điều kiện
 *   - redis.config.ts   -> `new Redis(REDIS_URL)` kết nối ngay
 *   - aiClient.config.ts-> chỉ thay generateStructuredOutput, giữ nguyên phần resolve model
 *
 * KHÔNG mock orm.config: test chạy trên Postgres thật (DB riêng english_quiz_test).
 * KHÔNG gọi initCronJobs(): không có worker BullMQ nào chạy trong test.
 */

// ─── Env mặc định ────────────────────────────────────────────────────────────
// `.env.test` bị gitignore nên máy mới (hoặc CI) có thể chưa có. Unit test không chạm DB,
// nên thay vì throw, điền mặc định để `bun run test:unit` chạy được ngay sau khi clone.
// Integration/e2e vẫn sẽ báo lỗi kết nối rõ ràng nếu DB test chưa được tạo.
const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/english_quiz_test',
  REDIS_URL: 'redis://localhost:6379/15',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  BETTER_AUTH_URL: 'http://localhost:3399',
  // aiClient.config.ts throw lúc import nếu thiếu. Không bao giờ dùng để gọi mạng:
  // generateStructuredOutput đã bị thay bằng mock ở cuối file này.
  OPENROUTER_API_KEY: 'test-key-never-used-generateStructuredOutput-is-mocked'
};

for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

// ─── Chặn nhầm DB ────────────────────────────────────────────────────────────
// Bảo hiểm cuối: test TRUNCATE toàn bảng, trỏ nhầm sang DB dev là mất sạch data.
const dbPath = new URL(process.env.DATABASE_URL!).pathname;
if (!/test/i.test(dbPath)) {
  throw new Error(
    `[test/setup] DATABASE_URL trỏ tới "${dbPath.slice(1)}" — tên database phải chứa "test". ` +
      'Từ chối chạy để không xoá nhầm data dev.'
  );
}

// ─── Logger: no-op ───────────────────────────────────────────────────────────
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  verbose: () => {},
  log: () => {},
  on: () => {}
};
mock.module('@/configs/logger.config', () => ({ default: noopLogger }));

// ─── Redis: in-memory ────────────────────────────────────────────────────────
/**
 * Chỉ cần đủ cho lock bucket: `SET key val EX <s> NX` + GET + DEL. Có TTL thật (so sánh
 * theo mốc thời gian) để test được ngữ nghĩa NX: key đang giữ thì lần set sau trả null.
 */
class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string): { value: string; expiresAt: number | null } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    const flags = args.map((arg) => String(arg).toUpperCase());
    const exIndex = flags.indexOf('EX');
    const ttlSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : null;
    const nx = flags.includes('NX');

    if (nx && this.live(key)) return null;

    this.store.set(key, {
      value,
      expiresAt: ttlSeconds && Number.isFinite(ttlSeconds) ? Date.now() + ttlSeconds * 1000 : null
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async exists(key: string): Promise<number> {
    return this.live(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  async flushall(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  async quit(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  on(): this {
    return this;
  }
}

export const testRedis = new InMemoryRedis();
mock.module('@/configs/redis.config', () => ({ default: testRedis }));

// ─── Mail: no-op ─────────────────────────────────────────────────────────────
mock.module('@/configs/mail.config', () => ({
  mailEnabled: true,
  sendMail: async () => {}
}));

// ─── LLM: chỉ thay generateStructuredOutput ──────────────────────────────────
// Giữ nguyên resolveStudyModel/resolveStudyModels/pickStudyModelForContext (đọc bảng
// ai_models thật) để test được cả nhánh "model id không hợp lệ -> 400".
const actualAiClient = await import('@/configs/aiClient.config');
mock.module('@/configs/aiClient.config', () => ({
  ...actualAiClient,
  generateStructuredOutput: invokeMockedStructuredOutput
}));
