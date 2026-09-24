---
name: llm-generation
description: Work with LLM calls, prompts and structured output in english-quiz-api (OpenRouter via generateStructuredOutput, model selection per context, cost, prompt builders in src/core/services/english/prompt/, zod output schemas). Use when writing or editing prompts, adding a generator, changing model/provider selection, or debugging invalid LLM output.
---

# LLM generation

## Single path to the model
`src/configs/aiClient.config.ts`
- `generateStructuredOutput(zodSchema, { model, provider, instructions, input, temperature, maxOutputTokens })` → `{ data, usage }`. Calls OpenRouter `chat.send` with one required tool; falls back to parsing JSON from text. **Never call OpenRouter any other way.**
- `ModelContext = 'schedule' | 'manual' | 'reading'`.
- `resolveStudyModel(context, explicitModelId?)`, `resolveStudyModels(context, ids?)`, `pickStudyModelForContext(context)` — pick an active model + provider preferences (see `ai-model-provider` skill).
- Cost: `computeCostUsd(await aiModelService.getModelByModelId(model), tokenIn, tokenOut)` from `src/core/services/ai/aiModel.service.ts`.

## Prompt organisation (`src/core/services/english/prompt/`)
- One file per quiz type: `<type>-prompt.ts` exporting `build<Type>Prompt(wrongAnswerCount, { count?, topic?, excludeWords? })` and the question TS type.
- Level/beginner addendum: `buildLevelInstruction(ctx, quizType)` in `study.service.ts`; beginner text in `beginner-prompt.ts`.
- `question-schema-map.ts` — `QUESTION_SCHEMA_BY_TYPE` (zod schema per quiz type; used by review/sibling).
- `review-prompt.ts` + `review-type-spec.ts` — AI review (see `pool-review`).
- `sibling-prompt.ts` — sibling generation + `SIBLING_LOCK_FIELDS_BY_TYPE` (see `sibling-question`).
- `reading-passage-prompt.ts`, `reading-passage-prompt-academic.ts`, `reading-prompt.ts` — passages.
- `reading-question/` — per-type module registry (see `reading-question`).
- Guidelines to follow when writing prompts: `docs/generate-question-common-rule.md`, `docs/question-generator-guideline.md`, `docs/reading-prompt-guideline.md`.

## Output schemas & validation
- Zod schemas live next to the generator: `*QuestionSchema` / `*BatchSchema` in `study.service.ts` (batch = `z.object({ questions: z.array(X).min(1).max(5) })`).
- After the call, run semantic validators (`study.validators.ts`, `sibling.validators.ts`) — array counts, `___` present in fill-blank, answer in options, etc. Invalid items are dropped (batch) or throw (single).
- Response schemas for the HTTP layer re-use these schemas in `src/api/common/responseSchemas.ts`.

## Rules
- Prompts are plain template strings; keep shared rules in common blocks rather than copy-pasting.
- Pass `excludeWords` / recent titles to avoid duplicates (config: `getExcludeRecentTitleCount`, etc.).
- Log `[StudyService] Generating <type> ...` before calls; record usage/cost in cron tracking when running inside a job.

## Testing
- `generateStructuredOutput` is always mocked (`test/setup.ts` → `invokeMockedStructuredOutput`). Queue answers with `mockLLM.enqueue(fixture)` (validated against the call's zod schema), `enqueueRaw` for invalid data, `fail()` for errors, `respond(fn)` for dynamic answers. A call with nothing queued throws.
- Fixtures: `test/fixtures/pool-question.fixture.ts` (`QUESTION_FIXTURE_BY_TYPE`), `reading.fixture.ts`, `review.fixture.ts`.
- Validator tests: `test/unit/study-validators.test.ts`, `sibling-validate.test.ts`, `beginner-prompt.test.ts`, `fixtures-valid.test.ts`.
