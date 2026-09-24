---
name: testing
description: Write or fix tests in english-quiz-api (bun test, unit / integration / e2e journeys, mockLLM, in-memory Redis, test DB english_quiz_test, FINDINGS.md). Use whenever adding tests for a feature, reproducing a bug, or running bun run test / test:unit / test:integration / test:e2e.
---

# Testing

Full guide: `docs/testing.md` (§6 test map, §7 conventions). Commands: `bun run test`, `test:unit`, `test:integration`, `test:e2e` (all use `--env-file=.env.test`), `bun run test:db:migrate` to prepare the test DB.

## Hard rules
- Separate DB `english_quiz_test`. `test/setup.ts` refuses to run if `DATABASE_URL` does not contain `test`. Never point tests at the dev DB.
- LLM is **always** mocked at `generateStructuredOutput`; no real OpenRouter calls. Redis is an in-memory mock (`testRedis`). BullMQ workers never run. Mail is a no-op. Logger is silenced.
- Name tests by **business rule** (Vietnamese, like the existing suite): `it('bucket đầy thì bỏ qua, không overwrite')`, not `it('pushQuestions returns 0')`.
- Cover every business rule and user journey of the feature, not just the happy path.
- Found a bug while writing tests → add an entry to `test/notes/FINDINGS.md`, write a test locking **current** behaviour tagged `[đặc tả hiện trạng]` plus an `it.todo` for the desired behaviour. **Do not fix the logic** in the same change.
- e2e asserts on `error.code`, never `message`. No fixed `sleep` — use `waitForRun` or a conditional loop with timeout.

## Layout
- `test/unit/` — pure functions, no DB.
- `test/integration/` — real Postgres, call services directly. `beforeEach(async () => { await resetDb(); mockLLM.reset(); })`.
- `test/e2e/jN-<journey>.test.ts` — HTTP through `app.handle`, `beforeAll` per journey. Next free number: check `ls test/e2e`.

## Helpers (`test/helpers/`)
| Helper | Exports |
|---|---|
| `llm.helper.ts` | `mockLLM.{reset, enqueue, enqueueRaw, enqueueMany, fail, always, respond, calls, callCount, lastCall, pending}` |
| `db.helper.ts` | `resetDb()` (truncate all but config, reset config defaults), `countRows(table)` |
| `config.helper.ts` | `setConfig({...})` (goes through bulk update), `snapshot()`, `disableAllJobs()` |
| `app.helper.ts` | `api.get/post/patch/put/delete(path, { token, body, query })`, `expectOk(res)`, `expectError(res, status, code)`, `waitForRun` |
| `auth.helper.ts` | `createAdminUser()`, `createNormalUser()`, `banUser()` |
| `tenant.helper.ts` | `createTestTenant({ topicIds, quizTypes })` → plaintext `apiKey` |
| `seed.helper.ts` | `createTopic`, `seedPoolQuestion(s)`, `seedPassage`, `seedReadingQuestion`, `seedReadyPassage`, `seedCronBucketHistory` |
| `test/fixtures/*` | `vocabQuestion({ overrides })` etc., `QUESTION_FIXTURE_BY_TYPE`, `readingQuestionResponder()`, `reviewResult()` |

## Example
```ts
it('source không tồn tại thì báo NotFound và không gọi LLM', async () => {
  await expect(siblingQuestionService.generateSiblingsForSource(999, { count: 2 })).rejects.toThrow(NotFoundException);
  expect(mockLLM.callCount).toBe(0);
});
```

## After adding tests
Update the test map in `docs/testing.md` §6 when adding a new test file.
