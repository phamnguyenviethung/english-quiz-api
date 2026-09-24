# Checklist: add a new quiz type

Use an existing type as template — `verb-use-match` is the most recent one; `grep -rn "verb-use-match\|VerbUseMatch" src test` shows every touch point.

## Source
1. `src/core/services/english/questionTypes.ts`
   - Append to `QUIZ_TYPES` and `QUIZ_TYPE_DEFINITIONS` (`value`, `label`, `title`).
   - If siblings are supported, add to `SIBLING_SUPPORTED_QUIZ_TYPES`.
2. `src/core/services/english/englishConfig.defaults.ts`
   - `quiz_distribution` default entry `{ quizType, weight, enabled }`.
   - `beginner_quiz_types` default entry `{ quizType, enabled }`.
3. `src/core/services/english/prompt/<type>-prompt.ts` — `build<Type>Prompt(wrongAnswerCount, { count?, topic?, excludeWords? })` + exported `<Type>Question` TS type. Follow `docs/generate-question-common-rule.md`.
4. `src/core/services/english/study.service.ts`
   - `<Type>QuestionSchema` (exported) + `<Type>BatchSchema` (`min(1).max(5)`).
   - `generate<Type>Question(ctx, excludeWords)` and `generate<Type>Batch(ctx, opts)` using `buildLevelInstruction(ctx, '<type>')`.
   - Case in the dispatch switch near the end of the class.
5. `src/core/services/english/study.validators.ts` — semantic checks if needed.
6. `src/core/services/english/prompt/question-schema-map.ts` — `QUESTION_SCHEMA_BY_TYPE['<type>']`.
7. `src/core/services/english/prompt/review-type-spec.ts` — type spec text + every `switch (quizType)` (learner view, answer key, etc.).
8. `src/core/services/english/prompt/beginner-prompt.ts` — beginner addendum for the type.
9. Sibling support (optional): `prompt/sibling-prompt.ts` (`SIBLING_LOCK_FIELDS_BY_TYPE` + type spec) and `sibling.validators.ts` switch.
10. `src/core/cron/question-gen.job.ts` — batch dispatch switch case.
11. `src/api/controllers/english.controller.ts` — `GenerateResult` union member.
12. `src/api/common/responseSchemas.ts` — import schema + union member with `z.literal('<type>')`.

## Tests
- `test/fixtures/pool-question.fixture.ts` — `<type>Question(options)` factory + entry in `QUESTION_FIXTURE_BY_TYPE` (`fixtures-valid.test.ts` checks it against the schema automatically).
- Unit tests that enumerate types: `bucket-key`, `beginner-prompt`, `sibling-validate` (if siblings).
- An e2e serving assertion in `test/e2e/j1-tenant-serving.test.ts` if tenants can request it.

## Docs & clients
- `docs/question-pool.md`, `docs/generate-question-common-rule.md`, `docs/sibling-question.md` (supported table), `docs/beginner.md`.
- Dashboard: regenerate the Orval client and update type-specific UI (see `api-contract-sync`).
