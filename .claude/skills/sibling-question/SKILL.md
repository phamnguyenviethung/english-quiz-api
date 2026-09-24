---
name: sibling-question
description: Sibling question generation in english-quiz-api — new pool rows that test the same locked term as a source question (manual per-source, manual bucket refill, scheduled sibling-gen cron). Use when touching siblingQuestion.service.ts, siblingRefill.service.ts, sibling-prompt.ts, sibling.validators.ts, sibling-gen.job.ts or /admin/pool/siblings/*.
---

# Sibling question

Full spec: `docs/sibling-question.md`.

## Domain rules
- Siblings are normal pool rows with `english_question_pool.sourceQuestionId` (provenance only). No approval step.
- Only types in `SIBLING_SUPPORTED_QUIZ_TYPES` (`questionTypes.ts`); others → 400 `BusinessLogicException`.
- Locked fields per type: `SIBLING_LOCK_FIELDS_BY_TYPE` in `prompt/sibling-prompt.ts` — must stay byte-identical; `sibling.validators.ts` rejects candidates that change locked fields or aren't materially different.
- Same CEFR level, topic and `forBeginner` as the source.
- Manual per-source: `POST /admin/pool/siblings/:id { count 1..5, model?, adminNote? }`, synchronous, context `manual`, `forceInsert: true`. Guard `activeSiblingSourceIds` blocks double submit.
- Bucket refill (`POST /admin/pool/siblings/refill`) and cron (`sibling-gen.job.ts`, config `sibling_gen` + `sibling_gen_schedule`, flag `job_flags.siblingGenEnabled`) share `processSiblingBucket` and the Redis bucket lock with question-gen.
- Source picking prefers sources without siblings yet.

## File map
| Concern | Path |
|---|---|
| Per-source generation | `src/core/services/english/siblingQuestion.service.ts` (`generateSiblingsForSource`, `SIBLING_MAX_PER_CALL`) |
| Bucket/cron refill | `src/core/services/english/siblingRefill.service.ts` (`processSiblingBucket`, `resolveKnobs`, `buildManualSiblingPlan`, `runManualSiblingRefill`) |
| Prompt | `src/core/services/english/prompt/sibling-prompt.ts` (reuses `buildLearnerView`/`buildAnswerKey` from `review-type-spec.ts`) |
| Validation | `src/core/services/english/sibling.validators.ts` |
| Job | `src/core/cron/sibling-gen.job.ts` |
| Routes | `/admin/pool/siblings/{supported-types,buckets,refill}`, `/admin/pool/siblings/:id` |

## Recipes
- **Enable siblings for a quiz type** → add to `SIBLING_SUPPORTED_QUIZ_TYPES`, lock fields + type spec in `sibling-prompt.ts`, case in `sibling.validators.ts`, supported table in docs, `test/unit/sibling-validate.test.ts`.
- **Change cron knobs** → `sibling_gen` config namespace (`english-config` skill) + `resolveKnobs`.

## Tests
- Integration: `sibling-question`, `sibling-refill`. Unit: `sibling-knobs`, `sibling-validate`. E2E: `j6-sibling`.
