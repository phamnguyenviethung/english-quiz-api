import { createApp } from '@/api/api';

/**
 * App dùng chung cho e2e. Dựng 1 lần rồi cache: mỗi lần createApp() lại là một lần đăng ký
 * toàn bộ route + sinh OpenAPI spec, tốn ~vài trăm ms.
 *
 * mountQueueBoard: false vì test không gọi initCronJobs() — các queue BullMQ khi đó vẫn
 * undefined, đưa vào BullMQAdapter sẽ nổ.
 */

type App = Awaited<ReturnType<typeof createApp>>;

let cached: App | null = null;

export async function getApp(): Promise<App> {
  if (!cached) cached = await createApp({ mountQueueBoard: false });
  return cached;
}

const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3399';

export interface RequestOptions {
  /** Session token của Better Auth hoặc tenant API key `eqk_...` — đi vào Authorization: Bearer. */
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  /** Body đã parse JSON (null nếu body rỗng/không phải JSON). */
  body: T;
  headers: Headers;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Gọi app qua Request thật (không mở port) — đi qua đủ plugin, guard, và error handler. */
export async function req<T = unknown>(
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const app = await getApp();
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await app.handle(
    new Request(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })
  );

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body: body as T, headers: response.headers };
}

export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions) => req<T>('GET', path, options),
  post: <T = unknown>(path: string, options?: RequestOptions) => req<T>('POST', path, options),
  patch: <T = unknown>(path: string, options?: RequestOptions) => req<T>('PATCH', path, options),
  put: <T = unknown>(path: string, options?: RequestOptions) => req<T>('PUT', path, options),
  delete: <T = unknown>(path: string, options?: RequestOptions) => req<T>('DELETE', path, options)
};

/** Envelope thành công: { success: true, data }. Fail luôn nếu status/shape sai. */
export function expectOk<T>(res: ApiResponse<unknown>, status = 200): T {
  const body = res.body as { success?: boolean; data?: T } | null;
  if (res.status !== status || body?.success !== true) {
    throw new Error(`Mong đợi ${status} success, nhận ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return body.data as T;
}

/** Envelope lỗi: { success: false, error: { code } }. Trả về error để assert thêm. */
export function expectError(
  res: ApiResponse<unknown>,
  status: number,
  code?: string
): { code?: string; message?: string } {
  const body = res.body as { success?: boolean; error?: { code?: string; message?: string } } | null;
  if (res.status !== status || body?.success !== false || !body.error) {
    throw new Error(`Mong đợi lỗi ${status}, nhận ${res.status}: ${JSON.stringify(res.body)}`);
  }
  if (code && body.error.code !== code) {
    throw new Error(`Mong đợi error.code=${code}, nhận ${body.error.code}`);
  }
  return body.error;
}

/**
 * Đợi một cron run chạy xong. Đúng cách admin dashboard poll: gọi lại
 * `GET /english/cron/runs/:runId` tới khi status thoát khỏi 'running'.
 *
 * Cố ý KHÔNG dùng sleep cố định — refill là fire-and-forget, thời gian chạy phụ thuộc số
 * bucket, chờ cứng vừa chậm vừa flaky.
 */
export async function waitForRun(
  runId: string,
  token: string,
  timeoutMs = 15000
): Promise<{ run: { status: string; [key: string]: unknown }; buckets: unknown[]; attempts: unknown[] }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await api.get<{ success: boolean; data: { run: { status: string } } }>(`/english/cron/runs/${runId}`, {
      token
    });
    const detail = res.body?.data;
    if (detail && detail.run.status !== 'running') return detail as never;
    await Bun.sleep(25);
  }

  throw new Error(`Hết thời gian chờ run ${runId} kết thúc`);
}
