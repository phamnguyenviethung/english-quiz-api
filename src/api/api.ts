import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';
import openapi from '@elysiajs/openapi';
import logger from '@/configs/logger.config';
import { auth, generateAuthOpenAPISchema, trustedOrigins } from '@/configs/auth.config';
import { getAdminUser } from './plugins/adminAuth.plugin';
import { UnauthorizedException } from '@/core/exceptions';
import { ok } from './common/response';
import { errorHandler } from './common/errorHandler';
import { englishRoute } from './routes/english.route';
import { adminRoute } from './routes/admin.route';
import { questionGenQueue } from '@/core/cron/question-gen.job';
import { poolRefillQueue } from '@/core/cron/pool-refill.job';
import { siblingGenQueue } from '@/core/cron/sibling-gen.job';
import { readingRefillQueue } from '@/core/cron/reading-gen.job';
import { readingQuestionRefillQueue } from '@/core/cron/reading-question-gen.job';
import { z } from 'zod';
import { t } from 'elysia';
import { ApiOk, ApiErrorSchema } from './common/responseSchemas';
import { sanitizeOpenApiSpec } from './common/openapiSanitizer';

export interface CreateAppOptions {
  /**
   * Mount Bull Board tại /queues. Mặc định true (đường chạy production).
   *
   * Phải tắt khi chưa gọi initCronJobs(): các queue là `export let` chỉ được gán bên trong
   * initCronJobs(), truyền undefined vào BullMQAdapter sẽ nổ ngay lúc dựng app. Test dựng app
   * mà không chạy worker nào nên luôn truyền false.
   */
  mountQueueBoard?: boolean;
}

/**
 * Dựng Elysia app đầy đủ nhưng KHÔNG listen. Tách khỏi startApi() để test gọi thẳng
 * `app.handle(new Request(...))` — không cần mở port, không tranh chấp port giữa các file test.
 */
export async function createApp(opts: CreateAppOptions = {}) {
  const mountQueueBoard = opts.mountQueueBoard ?? true;

  // Kiểu do @bull-board/elysia trả về, để TS tự suy luận thay vì ép về Elysia rỗng.
  let queueBoardPlugin: Awaited<
    ReturnType<InstanceType<typeof import('@bull-board/elysia').ElysiaAdapter>['registerPlugin']>
  > | null = null;
  if (mountQueueBoard) {
    const { createBullBoard } = await import('@bull-board/api');
    const { BullMQAdapter } = await import('@bull-board/api/bullMQAdapter');
    const { ElysiaAdapter } = await import('@bull-board/elysia');

    const serverAdapter = new ElysiaAdapter('/queues');

    createBullBoard({
      queues: [
        new BullMQAdapter(questionGenQueue),
        new BullMQAdapter(poolRefillQueue),
        new BullMQAdapter(siblingGenQueue),
        new BullMQAdapter(readingRefillQueue),
        new BullMQAdapter(readingQuestionRefillQueue)
      ],
      serverAdapter
    });

    // registerPlugin() là async (resolve về Elysia instance). Elysia 1.4.x không nuốt
    // Promise trong .use() nữa nên phải await trước khi mount.
    queueBoardPlugin = await serverAdapter.registerPlugin();
  }

  const base = new Elysia()
    .use(errorHandler)
    .use(
      cors({
        // Phải khai origin cụ thể + credentials: true để cookie phiên đăng nhập đi được
        // từ dashboard sang API. `set-auth-token` bắt buộc nằm trong exposeHeaders —
        // plugin `bearer` trả session token qua header này, không expose thì SPA không
        // đọc được token sau khi đăng nhập.
        origin: trustedOrigins.length > 0 ? trustedOrigins : true,
        credentials: true,
        exposeHeaders: ['set-auth-token']
      })
    )
    // Bull Board là browser UI (không gửi được Bearer header) nên chặn bằng cookie phiên
    // admin. Check prefix ở hook global thay vì bọc queueBoardPlugin: plugin đó là instance
    // ngoài, muốn hook chạm tới route của nó thì phải `.as('scoped')` — mà scoped sẽ rò
    // guard ngược lên toàn bộ app.
    .onBeforeHandle({ as: 'global' }, async ({ path, request }) => {
      if (!path.startsWith('/queues')) return;
      const adminUser = await getAdminUser(request.headers);
      if (!adminUser) throw new UnauthorizedException('Cần đăng nhập tài khoản admin để xem Bull Board');
    })
    // Better Auth tự phục vụ /api/auth/* (sign-in, sign-up, session, OAuth callback...).
    .mount(auth.handler)
    // Sanitize spec JSON do @elysiajs/openapi sinh (const/type:null hợp lệ 3.1, nhưng
    // converter còn phát sinh `nullable` thừa, numeric-enum sai type, và t.Tuple cú pháp
    // 3.0) trước khi trả cho client — xem src/api/common/openapiSanitizer.ts. Chỉ chạm
    // đúng route serve spec, các response khác đi qua nguyên vẹn.
    .onAfterHandle({ as: 'global' }, ({ path, response }) => {
      if (path === '/openapi/json' && response && typeof response === 'object') {
        return sanitizeOpenApiSpec(response as Record<string, unknown>);
      }
    })
    .use(
      openapi({
        mapJsonSchema: {
          zod: z.toJSONSchema
        },
        provider: 'swagger-ui',
        documentation: {
          // @elysiajs/openapi mặc định khai openapi "3.0.3" nhưng converter (TypeBox +
          // z.toJSONSchema) lại sinh JSON Schema 2020-12 (const, type:"null") — chỉ hợp lệ
          // ở 3.1. Override sang 3.1.0 để spec đúng chuẩn. Lib spread ...documentation sau
          // default nên override này có hiệu lực. Swagger UI (version latest) hỗ trợ 3.1.
          openapi: '3.1.0',
          tags: [
            { name: 'Health', description: 'Liveness check (public, không auth).' },
            { name: 'Admin / Tenants', description: 'Tenant CRUD. Yêu cầu tài khoản admin.' },
            { name: 'Admin / Models', description: 'AI Model CRUD (dùng cho sinh câu hỏi). Yêu cầu tài khoản admin.' },
            { name: 'Admin / API Keys', description: 'Issue/list/revoke tenant API key. Yêu cầu tài khoản admin.' },
            {
              name: 'Admin / Grants',
              description: 'Gán allow-list topic/quizType cho tenant. Yêu cầu tài khoản admin.'
            },
            {
              name: 'Admin / Pool',
              description: 'Refill thủ công toàn bộ question pool. Yêu cầu tài khoản admin.'
            },
            {
              name: 'Admin / Pool Review',
              description: 'AI review + admin approve/reject cho câu hỏi trong pool. Yêu cầu tài khoản admin.'
            },
            {
              name: 'Admin / Reading Questions',
              description: 'Kho câu hỏi đọc hiểu sinh từ reading passage + refill thủ công. Yêu cầu tài khoản admin.'
            },
            { name: 'English / Meta', description: 'Metadata tĩnh (danh sách quiz type).' },
            {
              name: 'English / Generation',
              description: 'Sinh câu hỏi on-demand bằng LLM (theo quizType + reading).'
            },
            { name: 'English / Question Pool', description: 'Pop/count/fill/pick câu hỏi trong pool.' },
            {
              name: 'English / Readings',
              description: 'Lấy bài đọc kèm bộ câu hỏi đọc hiểu đã sinh sẵn.'
            },
            {
              name: 'English / Config',
              description: 'Config runtime của English (pool size, distribution, job flags).'
            },
            { name: 'English / Topics', description: 'List/tạo topic, lấy cặp topic ngẫu nhiên.' },
            { name: 'English / Cron Tracking', description: 'Theo dõi các lần chạy cron sinh câu hỏi/refill pool.' }
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                description:
                  'Tenant API key (`eqk_...`) cho `/english/*`, hoặc **session token của Better Auth** (lấy từ ' +
                  'header `set-auth-token` khi gọi `POST /api/auth/sign-in/email`). Tài khoản có `role = "admin"` ' +
                  'là super key: dùng được cho cả `/admin/*` lẫn `/english/*` kể cả endpoint admin-only, và bỏ ' +
                  'qua allow-list topic/quizType. Trình duyệt có thể dùng cookie phiên thay cho Bearer.'
              }
            }
          }
        }
      })
    );

  // Giữ nguyên vị trí trong chuỗi đăng ký (sau openapi, trước các route) — thứ tự này
  // load-bearing, xem các comment ở trên. Gọi rời thay vì nối chuỗi vì plugin có thể vắng mặt.
  if (queueBoardPlugin) base.use(queueBoardPlugin);

  const app = base
    .get('/health', () => ok({ status: 'ok' as const }), {
      detail: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Liveness probe. Luôn trả { status: "ok" } nếu process đang chạy.',
        security: []
      },
      response: {
        200: ApiOk(t.Object({ status: t.Literal('ok') })),
        500: ApiErrorSchema
      }
    })
    // Spec OpenAPI riêng của Better Auth (plugin openAPI). Ẩn khỏi spec chính vì
    // /api/auth/* do handler của Better Auth phục vụ, không đi qua router Elysia.
    .get('/openapi-auth', async () => generateAuthOpenAPISchema(), { detail: { hide: true } })
    .use(adminRoute)
    .use(englishRoute);

  return app;
}

export async function startApi(): Promise<void> {
  const app = await createApp({ mountQueueBoard: true });

  const port = process.env.PORT ? Number(process.env.PORT) : 3220;
  app.listen(port);
  logger.info(`[Server] Started at port ${port}`);
}
