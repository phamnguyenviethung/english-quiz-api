import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';
import openapi from '@elysiajs/openapi';
import logger from '@/configs/logger.config';
import { englishRoute } from './routes/english.route';
import { questionGenQueue } from '@/core/cron/question-gen.job';
import { poolRefillQueue } from '@/core/cron/pool-refill.job';

export async function startApi(): Promise<void> {
  // Dynamic import: @bull-board/elysia là CJS và require('elysia') theo chuỗi sẽ
  // kéo memoirist (nhánh export "bun" = ESM-async) — Bun không cho require() module
  // ESM-async. Nạp bull-board bằng await import() (sau khi elysia đã có trong ESM
  // cache) né được chuỗi require đồng bộ này.
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
    .use(cors())
    .use(openapi())
    .use(queueBoardPlugin)
    .get('/health', () => ({ status: 'ok' }))
    .use(englishRoute);

  const port = process.env.PORT ? Number(process.env.PORT) : 3220;
  app.listen(port);
  logger.info(`[Server] Started at port ${port}`);
}
