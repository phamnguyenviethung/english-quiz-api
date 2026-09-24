---
name: bullmq-job
description: Add or change a BullMQ cron/queue job in english-quiz-api (scheduled refill, generation workers, FlowProducer parent/child, Redis bucket locks, cron run tracking). Use when touching src/core/cron/*.job.ts, src/core/cron/index.ts, Bull Board in src/api/api.ts, *_schedule config records or englishCronJobTracking.service.ts.
---

# BullMQ jobs

## Files
- `src/core/cron/cron.config.ts` — `bullmqConnection`, `TIMEZONE = 'Asia/Ho_Chi_Minh'`.
- `src/core/cron/index.ts` — `initCronJobs()` (marks stale runs failed, then inits every job) and `shutdownCronJobs()` (closes every queue/worker/flow producer).
- Jobs:
  - `question-gen.job.ts` — on-demand bucket fill (`fillBucketDetailed`), quiz-type dispatch switch.
  - `pool-refill.job.ts` — scheduled pool refill, FlowProducer parent/child.
  - `sibling-gen.job.ts` — scheduled sibling generation (simple queue + worker, the easiest template).
  - `reading-gen.job.ts`, `reading-question-gen.job.ts` — reading refill flows.
- Queue names: constants in `src/core/services/english/*Refill.service.ts` (e.g. `POOL_REFILL_PARENT_QUEUE`) or `QUEUE_NAME` in the job file.
- Run tracking: `src/core/services/english/englishCronJobTracking.service.ts` (`startRun`, `finishRun`, `summarizeRun`, `markStaleRunsFailed`), statuses in `cronRunStatus.ts`. See `cron-tracking` skill.
- Redis: `src/configs/redis.config.ts` — used **only** for bucket locks (no data cache).

## Canonical job shape (from `sibling-gen.job.ts`)
```ts
const QUEUE_NAME = 'english-sibling-gen'; const LOG_TAG = 'SiblingGen';
export let siblingGenQueue: Queue; export let siblingGenWorker: Worker;
export async function reconcileSiblingGenSchedulers() { /* read getEnglishConfigSnapshot().<ns>_schedule, remove stale, upsertJobScheduler(name, { pattern: cron, tz: TIMEZONE }) */ }
export default async function siblingGenJob() {
  siblingGenQueue = new Queue(QUEUE_NAME, { connection: bullmqConnection, defaultJobOptions: { removeOnComplete: true, removeOnFail: 10 } });
  await reconcileSiblingGenSchedulers();
  onEnglishConfigChanged('sibling_gen_schedule.items', () => reconcileSiblingGenSchedulers());
  siblingGenWorker = new Worker(QUEUE_NAME, handler, { connection: bullmqConnection, concurrency: 1 });
  siblingGenWorker.on('failed', ...); siblingGenWorker.on('completed', ...);
}
```
Handler flow: check `getEnglishConfigSnapshot().job_flags.<x>Enabled` → scan buckets → `startRun` → per bucket take Redis lock `set(key,'1','EX',300,'NX')` (key `question-pool:lock:${bucketKeyOf(c)}`) → process → `del` lock in `finally` → `summarizeRun` / `finishRun(run, { status: 'failed', ... })` on error.

## Recipe: add a new job
1. Create `src/core/cron/<name>.job.ts` following the shape above. Keep business logic in a service (`src/core/services/english/*Refill.service.ts`), the job only orchestrates.
2. If it is scheduled from config: add `<name>_schedule` + enable flag in `job_flags` (see `english-config` skill), reconcile schedulers on `onEnglishConfigChanged`.
3. Register in **3 places**:
   - `initCronJobs()` in `src/core/cron/index.ts`
   - `shutdownCronJobs()` in the same file (close worker(s), queue(s), flow producer)
   - Bull Board adapters list in `src/api/api.ts` (`new BullMQAdapter(queue)`)
4. Add a new `EnglishCronJobKey` in `englishCronJobTracking.service.ts` if runs should be tracked.
5. Log with `[${LOG_TAG}]` prefix; `logger.error` on failures.
6. Update the domain doc (e.g. `docs/question-pool.md` "Scheduled Pool Refill", `docs/english-config.md` §5).

## Testing
- Workers **never run** in tests. Test the service function the worker calls (e.g. `processSiblingBucket`, `runScheduledRefill`) directly; the Redis client is an in-memory mock (`testRedis` from `test/setup.ts`).
- Pure planning logic gets unit tests (`test/unit/refill-plan.test.ts`, `on-demand-refill-job.test.ts`).
- Lock behaviour: `test/integration/question-gen-lock.test.ts`.
- `createApp({ mountQueueBoard: false })` in tests because queues are undefined before `initCronJobs()`.
