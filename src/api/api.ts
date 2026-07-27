import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';
import openapi from '@elysiajs/openapi';
import logger from '@/configs/logger.config';
import { ok } from './common/response';
import { errorHandler } from './common/errorHandler';
import { englishRoute } from './routes/english.route';
import { adminRoute } from './routes/admin.route';
import { questionGenQueue } from '@/core/cron/question-gen.job';
import { poolRefillQueue } from '@/core/cron/pool-refill.job';
import { z } from 'zod';
import { t } from 'elysia';
import { ApiOk, ApiErrorSchema } from './common/responseSchemas';
import { sanitizeOpenApiSpec } from './common/openapiSanitizer';

export async function startApi(): Promise<void> {
  const { createBullBoard } = await import('@bull-board/api');
  const { BullMQAdapter } = await import('@bull-board/api/bullMQAdapter');
  const { ElysiaAdapter } = await import('@bull-board/elysia');

  const serverAdapter = new ElysiaAdapter('/queues');

  createBullBoard({
    queues: [new BullMQAdapter(questionGenQueue), new BullMQAdapter(poolRefillQueue)],
    serverAdapter
  });

  // registerPlugin() là async (resolve về Elysia instance). Elysia 1.4.x không nuốt
  // Promise trong .use() nữa nên phải await trước khi mount.
  const queueBoardPlugin = await serverAdapter.registerPlugin();

  const app = new Elysia()
    .use(errorHandler)
    .use(cors())
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
            { name: 'Admin / Tenants', description: 'Tenant CRUD. Yêu cầu ADMIN_API_KEY.' },
            { name: 'Admin / API Keys', description: 'Issue/list/revoke tenant API key. Yêu cầu ADMIN_API_KEY.' },
            {
              name: 'Admin / Grants',
              description: 'Gán allow-list topic/quizType cho tenant. Yêu cầu ADMIN_API_KEY.'
            },
            { name: 'English / Meta', description: 'Metadata tĩnh (danh sách quiz type).' },
            {
              name: 'English / Generation',
              description: 'Sinh câu hỏi on-demand bằng LLM (theo quizType + reading).'
            },
            { name: 'English / Question Pool', description: 'Pop/count/fill/pick câu hỏi trong pool.' },
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
                scheme: 'bearer'
              }
            }
          }
        }
      })
    )
    .use(queueBoardPlugin)
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
    .use(adminRoute)
    .use(englishRoute);

  const port = process.env.PORT ? Number(process.env.PORT) : 3220;
  app.listen(port);
  logger.info(`[Server] Started at port ${port}`);
}
