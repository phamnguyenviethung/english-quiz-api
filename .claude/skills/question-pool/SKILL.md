---
name: question-pool
description: Question pool domain of english-quiz-api — pre-generated quiz questions bucketed by (engLevel, topicId, quizType, forBeginner), pop/count/list/fill, on-demand + scheduled + manual refill, quiz type generation via StudyService. Use when changing pool serving, refill logic, bucket sizing, or when adding/changing a quiz type.
---

# Question pool

Read `docs/question-pool.md` first (full flow, schema, refill mechanics). Generation rules: `docs/generate-question-common-rule.md`, `docs/question-generator-guideline.md`.

## Domain rules
- Bucket = `(engLevel, topicId, quizType, forBeginner)`; key always via `bucketKeyOf()` (`questionPool.service.ts`). `topicId = null` is a valid bucket (`IS NULL`).
- Max per bucket = `question_pool.maxPerBucket` (default 3). Refill threshold = `ceil(maxPerBucket * refillThresholdRatio)`. A full bucket skips insert — never overwrite.
- `popQuestion` is pure random (`ORDER BY RANDOM() LIMIT 1`); the question stays in the pool. `excludeIds` lets clients avoid repeats. Empty → 404 `NOT_FOUND`.
- Three refill mechanisms share one engine (`poolRefill.service.ts`):
  - **On-demand**: `POST /english/pool/fill` (admin only) → `question-gen.job.ts` queue, ratio threshold.
  - **Scheduled**: `pool-refill.job.ts` flow, config `pool_refill_schedule`, capped by `job_flags.poolRefillMaxQuestionsPerRun`.
  - **Manual**: `POST /admin/pool/refill` (preview + run), in-process bounded concurrency.
- Beginner and normal content never mix (see `beginner` skill).

## File map
| Concern | Path |
|---|---|
| Quiz type registry | `src/core/services/english/questionTypes.ts` (`QUIZ_TYPES`, `QUIZ_TYPE_DEFINITIONS`, `ENG_LEVELS`, sibling list, beginner constants) |
| Pool CRUD / pop / list | `src/core/services/english/questionPool.service.ts` |
| Refill engine | `src/core/services/english/poolRefill.service.ts` (`scanBuckets`, `buildRefillPlan`, `runScheduledRefill`, `runOnDemandRefill`, `buildManualRefillPlan`, `runManualRefill`) |
| On-demand trigger | `src/core/services/english/questionPoolTrigger.service.ts` |
| Generators | `src/core/services/english/study.service.ts` (class `StudyService`, schemas + `generate<Type>Question` / `generate<Type>Batch`, dispatch switch at the end) |
| Validators | `src/core/services/english/study.validators.ts` |
| Prompts | `src/core/services/english/prompt/<type>-prompt.ts` |
| Jobs | `src/core/cron/question-gen.job.ts`, `src/core/cron/pool-refill.job.ts` |
| Table | `englishQuestionPool` in `src/core/db/schema/main.ts` |
| Routes | `/english/generate/:quizType`, `/english/pool/{pop,count,questions,models,fill,pick-quiz-type}`, `/english/quiz-types`; `/admin/pool/{buckets,refill}`, `PATCH /admin/pool/questions/:id` |
| Controllers | `english.controller.ts` (serving, `GenerateResult` union), `admin.controller.ts` (refill) |

## Recipes
- **Add a quiz type** → follow `references/add-quiz-type.md` (≈12 touch points; missing one breaks review/sibling/serving silently).
- **Change bucket sizing / thresholds** → config fields in `question_pool` namespace (see `english-config` skill), never hard-code.
- **Change list filters/sort** → `ListPoolQuestionsInput` + `POOL_QUESTIONS_SORTS` in `questionPool.service.ts`, TypeBox query in `english.route.ts`, then dashboard `question-pool` feature (see `api-contract-sync`).

## Tests
- Integration: `question-pool`, `pool-list`, `pool-refill-scan`, `question-gen-lock`, `beginner-pool`.
- Unit: `refill-plan`, `bucket-key`, `exclude-ids`, `on-demand-refill-job`, `study-validators`, `fixtures-valid`.
- E2E: `j1-tenant-serving`, `j4-pool-refill`.
Update `docs/question-pool.md` whenever behaviour changes.
