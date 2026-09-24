---
name: cron-tracking
description: Cron run tracking and usage monitoring in english-quiz-api — english_cron_job_runs / buckets / model_attempts, run status derivation, token + USD cost usage, /english/cron/runs* and /english/cron/usage. Use when changing how jobs record runs, adding a job key, or changing usage/cost reports.
---

# Cron tracking

## Rules
- Every tracked job run: `startRun({ jobKey, trigger, queueName, bullJobId, bullJobName, totalBuckets, ... })` → per bucket + per model attempt records → `summarizeRun(run, ...)` or `finishRun(run, { status, errorPhase, error })`.
- Status is derived, never set by hand in summaries: `deriveRunStatus(counts)` in `cronRunStatus.ts` → `running | success | partial_success | failed | skipped`.
- Runs stuck in `running` after 2h are marked failed on boot (`markStaleRunsFailed` in `src/core/cron/index.ts`).
- Cost uses `computeCostUsd` / `sumCostUsd` from `aiModel.service.ts` with token counts from `generateStructuredOutput` usage.

## File map
| Concern | Path |
|---|---|
| Service | `src/core/services/english/englishCronJobTracking.service.ts` (`EnglishCronJobKey`, `EnglishCronJobTrigger`, `EnglishCronJobErrorPhase`, list/detail/usage queries, `normalizeError`) |
| Status | `src/core/services/english/cronRunStatus.ts` |
| Tables | `englishCronJobRun`, `englishCronJobBucket`, `englishCronJobModelAttempt` in `src/core/db/schema/main.ts` |
| Routes | `/english/cron/runs`, `/english/cron/runs/:runId`, `/english/cron/usage` in `english.route.ts` |
| Consumers | dashboard `cron-runs` and `dashboard` features |

## Recipe: track a new job
1. Add the key to `EnglishCronJobKey`.
2. Call `startRun` / `summarizeRun` / `finishRun` in the job (see `bullmq-job` skill).
3. Make sure list filters and usage queries accept the new key; update response schema + dashboard filter options (see `api-contract-sync`).
4. Doc: `docs/question-pool.md` §Monitor.

## Tests
Integration `cron-tracking`; unit `run-status`, `cost`. Seed history with `seedCronBucketHistory`; wait with `waitForRun`.
