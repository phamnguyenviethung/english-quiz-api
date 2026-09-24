---
name: reading-question
description: Reading comprehension questions generated from stored reading passages in english-quiz-api — CEFR-limited question types, one LLM call per question, per-type prompt modules, server-side answer shuffling, all-or-nothing per passage. Use when touching readingQuestion*.ts, readingQuestionTypes.ts, prompt/reading-question/**, reading-question-gen.job.ts or /admin/reading-questions*.
---

# Reading question

Full spec: `docs/reading-question.md`; content rules: `docs/question-generator-guideline.md`.

## Domain rules
- Bucket = 1 passage. Questions per passage: `getQuestionsPerPassage()`; caps `getPerPassageGenerationCap()`, `getMaxGenerationAttempts()` (config namespace `reading_question`).
- Question types (`READING_QUESTION_TYPES`) are limited per CEFR level: `CEFR_ALLOWED_QUESTION_TYPES`, composition via `CEFR_COMPOSITION_SLOTS` + `selectQuestionTypes()` in `readingQuestionTypes.ts`.
- **One LLM call per question**, rendering exactly one type module.
- Answer positions are shuffled on the server.
- **All-or-nothing**: a passage only becomes servable when it has the full set of questions.
- Editing a passage makes old questions garbage — they must be regenerated.
- Tenant pop (`/english/readings/pop`) returns a passage together with its questions.

## File map
| Concern | Path |
|---|---|
| Types & CEFR rules | `src/core/services/english/readingQuestionTypes.ts` |
| Service | `src/core/services/english/readingQuestion.service.ts` |
| Refill engine | `src/core/services/english/readingQuestionRefill.service.ts` (`readingQuestionBucketKeyOf`, `scanReadingQuestionBuckets`, `runScheduledReadingQuestionRefill`, manual plan/run) |
| Prompt registry | `src/core/services/english/prompt/reading-question/index.ts` (`MODULES`), `common.ts`, `module.ts` (`ReadingQuestionTypeModule`) |
| Type modules | `src/core/services/english/prompt/reading-question/types/*.ts` (13 files) |
| Job | `src/core/cron/reading-question-gen.job.ts` (config `reading_question_refill_schedule`) |
| Table | `englishReadingQuestion` in `src/core/db/schema/main.ts` |
| Routes | `/admin/reading-questions`, `/models`, `/buckets`, `/generate`, `/refill`, `/:id` (GET/PATCH/DELETE) |

## Recipe: add a reading question type
1. Add to `READING_QUESTION_TYPES`, labels, `QUESTION_TYPE_PLAYBOOK`, and to the CEFR levels in `CEFR_ALLOWED_QUESTION_TYPES` / slots.
2. Create `prompt/reading-question/types/<type>.ts` implementing `ReadingQuestionTypeModule` (`role`, `evidence`, `method`, `distractors`, `selfCheck`, `example`, `pitfalls`).
3. Register it in `MODULES` in `prompt/reading-question/index.ts` — import fails fast if an allowed type has no module.
4. Update `test/unit/reading-question-types.test.ts`, `docs/reading-question.md`, dashboard labels.

## Gotchas
- `docs/reading-question.md` still mentions `prompt/reading-question-prompt.ts`; the real code is the `prompt/reading-question/` folder.

## Tests
- Unit `reading-question-types`; integration `reading`; e2e `j7-reading`. Helpers: `seedReadingQuestion`, `seedReadyPassage`, `readingQuestionResponder()`.
