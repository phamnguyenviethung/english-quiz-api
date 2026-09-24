---
name: pool-review
description: AI review + admin approve/reject of question pool items in english-quiz-api (english_question_pool_reviews, review prompt, learner view / answer key, verdict/checklist/revisedData). Use when changing /admin/pool/reviews*, questionPoolReview.service.ts, review-prompt.ts or review-type-spec.ts.
---

# Pool review

Full spec: `docs/question-pool-review.md`.

## Domain rules
- `POST /admin/pool/reviews { poolQuestionIds, model?, adminNote? }` is fire-and-forget with bounded concurrency 3; max batch `POOL_REVIEW_BATCH_MAX`.
- A question with a `pending` review or one already running (module-level guard `activeReviewIds`) is `skipped`.
- Model resolved with context **`manual`** (`resolveStudyModel('manual', model?)`).
- The review prompt shows a **learner view** (options shuffled with a seed, correct answer hidden) + answer key + raw JSON; it does **not** reuse the generation prompt.
- `revisedData` is validated against `QUESTION_SCHEMA_BY_TYPE[quizType]` → `checklist.formatValid`. `changedFields` = top-level diff.
- LLM/parse failure → row `status='failed'` with `errorMessage`; batch continues.
- Only `pending` reviews can be approved/rejected. Approve overwrites `english_question_pool.questionData` with admin-edited `data` or `revisedData` (re-validated); reject never touches the pool item. Delete just removes the review row.

## File map
| Concern | Path |
|---|---|
| Service | `src/core/services/english/questionPoolReview.service.ts` |
| Prompt | `src/core/services/english/prompt/review-prompt.ts` (`buildReviewPrompt`) |
| Per-type view/spec | `src/core/services/english/prompt/review-type-spec.ts` (`buildLearnerView`, `buildAnswerKey`, type specs) |
| Schema map | `src/core/services/english/prompt/question-schema-map.ts` |
| Table | `englishQuestionPoolReview` in `src/core/db/schema/main.ts` (`POOL_REVIEW_STATUSES`) |
| Routes | `/admin/pool/reviews` (POST, GET), `/admin/pool/reviews/:id` (GET, DELETE), `/admin/pool/reviews/:id/{approve,reject}` in `admin.route.ts` |

## Recipes
- **Add a checklist flag** → review result zod schema in the service, prompt text, `PoolReviewChecklist` type, response schema, docs table, dashboard `pool-review` feature.
- **Support a new quiz type** → add cases in `review-type-spec.ts` (all switches) — part of the quiz type checklist in `question-pool` skill.

## Tests
- Integration `test/integration/pool-review.test.ts`, e2e `test/e2e/j5-review.test.ts`, fixture `test/fixtures/review.fixture.ts` (`reviewResult()`).
