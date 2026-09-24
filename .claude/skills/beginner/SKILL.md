---
name: beginner
description: Beginner content dimension in english-quiz-api — forBeginner flag across question pool, reading passages and reading questions (≤ B1, max 4 options, Cambridge wordlists, beginner prompt addendum, separate buckets, audience filter). Use when touching forBeginner, beginner-prompt.ts, BEGINNER_* constants, beginner_quiz_types config or ?beginner= / audience= params.
---

# Beginner

Beginner is a **cross-cutting dimension**, not its own module. Full spec: `docs/beginner.md`.

## Invariants (never break)
- Beginner and standard content **never mix**: every count / pop / refill filters on `forBeginner`. Tenant without `beginner=true` only gets standard content; with it, only beginner content.
- Levels only `BEGINNER_ENG_LEVELS` (A1, A2, B1); `optionCount = BEGINNER_MAX_OPTION_COUNT` (4); reading passages only `BEGINNER_READING_PASSAGE_TYPE` (`daily`).
- Separate bucket keys with `:beginner` suffix — always via `bucketKeyOf()` / `readingBucketKeyOf()`, never hand-built.
- Effective beginner quiz types = enabled in `beginner_quiz_types` **and** weight > 0 in `quiz_distribution` (`getBeginnerQuizTypes()` in `questionPool.service.ts`).
- Manual flagging returns 400 for B2, > 4 options, a type not enabled for beginner, or `academic` passages. Unflagging is always allowed.
- Turning off a topic's `forBeginner` only stops new beginner buckets; existing content stays.
- Old queued jobs without `forBeginner` are treated as standard.

## Where it lives
| Concern | Path |
|---|---|
| Constants | `src/core/services/english/questionTypes.ts` (`BEGINNER_ENG_LEVELS`, `BEGINNER_MAX_OPTION_COUNT`, `BEGINNER_READING_PASSAGE_TYPE`, `isBeginnerLevel`) |
| Prompt addendum | `src/core/services/english/prompt/beginner-prompt.ts` (appended by `buildLevelInstruction` in `study.service.ts`; `BEGINNER_TYPE_OVERRIDES`) |
| Bucket scans | `scanBuckets` (`poolRefill.service.ts`), `scanReadingBuckets` (`readingRefill.service.ts`) |
| Review/sibling level note | `describeLearnerLevel` in `prompt/review-prompt.ts` |
| Topic flag | `englishTopic.forBeginner`, `topic.service.ts` (`getActiveBeginnerTopics`) |
| Config | `beginner_quiz_types` in `englishConfig.defaults.ts` |
| Query param | `BeginnerQuerySchema` in `src/api/common/schemas.ts` |

## Recipe: add beginner support to a new content flow
1. Add `forBeginner` column + include it in bucket key helper.
2. Filter every count/pop/scan by `forBeginner`.
3. Append the beginner prompt block instead of the difficulty block.
4. Validate manual flagging rules (400 via `BusinessLogicException`).
5. Accept `beginner` query on tenant routes, `audience` on admin refill routes.
6. Tests + `docs/beginner.md`.

## Tests
Unit `beginner-prompt`; integration `beginner-pool`, `beginner-reading`; e2e `j9-beginner`.
