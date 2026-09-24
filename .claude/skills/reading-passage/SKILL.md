---
name: reading-passage
description: Reading passages in english-quiz-api — LLM-generated short reading texts (daily / academic) per topic + CEFR bucket, anti-duplicate titles, scheduled/manual refill, admin CRUD and tenant pop. Use when touching readingPassage.service.ts, readingRefill.service.ts, reading-passage-prompt*.ts, reading-gen.job.ts, /admin/readings* or /english/readings*.
---

# Reading passage

Full spec: `docs/reading-passage.md`; content rules: `docs/reading-prompt-guideline.md` (edit the matching prompt file when the guideline changes).

## Don't confuse
| Pipeline | Output | Table |
|---|---|---|
| `quizType = 'reading'` (`prompt/reading-prompt.ts`, `POST /english/generate-reading`) | reading quiz + mental math inside the question pool | `english_question_pool` |
| **Reading passage (this skill)** | plain passage, no questions | `english_reading_passages` |
| Reading question (`reading-question` skill) | questions generated from a stored passage | `english_reading_questions` |

## Domain rules
- `type` ∈ `READING_PASSAGE_TYPES` (`daily` default, `academic`). Prompts: `prompt/reading-passage-prompt.ts` (daily), `prompt/reading-passage-prompt-academic.ts` (academic — keep in sync manually).
- Bucket key: `readingBucketKeyOf()`; limits via `getMaxPerBucket`, `getRefillThreshold`, `getPerBucketGenerationCap` (config namespace `reading_passage`).
- Anti-duplicate: recent titles excluded (`getExcludeRecentTitleCount`).
- Model context `reading` (`resolveStudyModel('reading', ...)`).
- Beginner passages: only `daily` type (`BEGINNER_READING_PASSAGE_TYPE`), levels ≤ B1.
- Editing a passage makes its existing reading questions stale (see `reading-question`).

## File map
| Concern | Path |
|---|---|
| Service | `src/core/services/english/readingPassage.service.ts` |
| Refill engine | `src/core/services/english/readingRefill.service.ts` (`scanReadingBuckets`, `runScheduledReadingRefill`, `buildManualReadingRefillPlan`, `runManualReadingRefill`, queue names) |
| Job | `src/core/cron/reading-gen.job.ts` (FlowProducer parent/child, config `reading_refill_schedule`) |
| Table | `englishReadingPassage` in `src/core/db/schema/main.ts` |
| Routes | admin: `/admin/readings`, `/models`, `/buckets`, `/generate`, `/refill`, `/:id` (GET/PATCH/DELETE); tenant: `/english/readings/{pop,count}` |

## Tests
- Integration: `reading`, `beginner-reading`. E2E: `j7-reading`, `j9-beginner`. Helpers: `seedPassage`, `seedReadyPassage`, `test/fixtures/reading.fixture.ts`.
