# Testing

Bộ test chạy bằng `bun test`, chia 3 tầng: **unit** (logic thuần) → **integration** (service + Postgres thật) → **e2e** (HTTP thật qua `app.handle`).

Nguyên tắc xuyên suốt: **test hành vi nghiệp vụ, không test implementation**. Tên test là câu khẳng định business (`"bucket đầy thì pushQuestions bỏ qua, không overwrite"`), không phải mô tả kỹ thuật.

---

## 1. Chuẩn bị (một lần)

```bash
createdb english_quiz_test          # hoặc: psql -c 'CREATE DATABASE english_quiz_test'
cp .env.test.example .env.test      # sửa DATABASE_URL cho khớp Postgres của bạn
bun run test:db:migrate             # dựng schema lên DB test
```

`.env.test` bị gitignore. `DATABASE_URL` **bắt buộc** có chữ `test` trong tên database — `test/setup.ts` từ chối chạy nếu không, để không bao giờ TRUNCATE nhầm DB dev.

---

## 2. Chạy

```bash
bun run test              # tất cả
bun run test:unit         # chỉ logic thuần, không cần DB, ~0.4s
bun run test:integration  # service + DB test
bun run test:e2e          # user journey qua HTTP
```

`bunfig.toml` khai `preload = ["./test/setup.ts"]` nên mọi lệnh `bun test` đều nạp mock trước.

---

## 3. Hạ tầng: `test/setup.ts`

Chạy **trước mọi import**, là chỗ duy nhất mock được các module tạo kết nối ngay lúc import:

| Module                      | Xử lý                                              | Vì sao                                                                                                       |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@/configs/logger.config`   | thay bằng no-op                                    | file này khởi tạo `DiscordTransport` vô điều kiện                                                            |
| `@/configs/redis.config`    | in-memory (`SET .. EX .. NX`, `GET`, `DEL`, `TTL`) | không cần Redis thật; vẫn test đúng ngữ nghĩa lock bucket                                                    |
| `@/configs/mail.config`     | `sendMail` no-op                                   | không gửi mail thật                                                                                          |
| `@/configs/aiClient.config` | **chỉ** thay `generateStructuredOutput`            | giữ nguyên `resolveStudyModel*` (đọc bảng `ai_models` thật) để test được nhánh "model id không hợp lệ → 400" |
| `@/configs/orm.config`      | **không mock**                                     | integration/e2e chạy trên Postgres thật                                                                      |

**Không** gọi `initCronJobs()` → không worker BullMQ nào chạy. E2E đi đường **manual refill** (`POST /admin/pool/refill`) vốn chạy in-process, nên không cần queue.

---

## 4. Mock LLM

`generateStructuredOutput` là chokepoint **duy nhất** gọi OpenRouter trong toàn hệ thống (`study.service`, `questionPoolReview.service`, `siblingQuestion.service` đều đi qua nó). Thay đúng chỗ đó là chặn 100% chi phí mà vẫn chạy thật toàn bộ validate/dedupe/insert phía sau.

```ts
import { mockLLM } from '../helpers/llm.helper';

mockLLM.reset();                               // beforeEach
mockLLM.enqueue({ questions: [vocabQuestion()] });  // 1 response, có validate schema
mockLLM.enqueueRaw({ questions: [] });         // bỏ qua schema.parse (giả lập payload méo)
mockLLM.always(data);                          // response mặc định cho mọi lời gọi sau
mockLLM.respond((call) => ...);                // response TÍNH TỪ lời gọi
mockLLM.fail(new Error('OpenRouter 503'));     // lời gọi kế tiếp throw

mockLLM.callCount;  mockLLM.lastCall();  mockLLM.pending;
```

**Hết hàng đợi mà không set `always`/`respond` → mock THROW.** Test quên enqueue sẽ đỏ ngay thay vì âm thầm gọi mạng.

`enqueue` chạy `schema.safeParse(data)` giống hàm thật, nên fixture không trôi khỏi schema thực tế.

**Khi nào cần `respond`:** pipeline reading question — server tự random loại câu hỏi rồi gọi model một lần cho mỗi loại. Fixture cố định sẽ lệch loại và bị `isValidReadingQuestionDraft` loại **cả bộ** (all-or-nothing). Dùng `readingQuestionResponder()` để đọc loại từ chính lời gọi:

```ts
mockLLM.respond(readingQuestionResponder());
```

---

## 5. Helpers

| File                            | Dùng để                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `test/helpers/db.helper.ts`     | `resetDb()` (TRUNCATE + đưa config về default), `countRows()`                                    |
| `test/helpers/app.helper.ts`    | `api.get/post/patch/delete`, `expectOk`, `expectError`, `waitForRun`                             |
| `test/helpers/auth.helper.ts`   | `createAdminUser()`, `createNormalUser()`, `banUser()`                                           |
| `test/helpers/tenant.helper.ts` | `createTestTenant({ topicIds, quizTypes, allowAll* })`                                           |
| `test/helpers/config.helper.ts` | `setConfig({ 'question_pool.maxPerBucket': 5 })`                                                 |
| `test/helpers/seed.helper.ts`   | `createTopic`, `seedPoolQuestion(s)`, `seedPassage`, `seedReadyPassage`, `seedCronBucketHistory` |
| `test/helpers/llm.helper.ts`    | `mockLLM`                                                                                        |

**`resetDb()` giữ lại 2 bảng config** (`english_config_record_types`, `english_config_records`) và chỉ copy `default* → value*` bằng một UPDATE. Seed lại ~60 record metadata cho mỗi test là quá đắt.

**Seed đi bằng INSERT thẳng, không qua service** — cố ý: `pushQuestions()` có trần `maxPerBucket` bên trong, dùng nó để seed thì không dựng được trạng thái "bucket đã đầy" để test chính cái trần đó.

**Auth mint token qua `auth.api`, không qua `app.handle`** — Better Auth bật rateLimit 30 req/60s trên đường HTTP, e2e đăng nhập nhiều lần sẽ dính 429 vì lý do không liên quan nghiệp vụ.

**Fire-and-forget thì poll, đừng sleep:** `waitForRun(runId, token)` gọi lại `GET /english/cron/runs/:runId` tới khi status thoát khỏi `running` — đúng cách admin dashboard làm.

---

## 6. Bản đồ test

### Unit — `test/unit/` (không cần DB)

| File                                                      | Khoá bất biến gì                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `refill-plan.test.ts`                                     | `buildRefillPlan`: budget, `perBucketCap`, cắt một phần, `forceCount`, `cappedByBudget` |
| `sibling-knobs.test.ts`                                   | `resolveKnobs`: clamp `siblingsPerSource` ≤ 5 (trần batch schema LLM)                   |
| `sibling-validate.test.ts`                                | 4 cổng validate sibling: schema / khoá field / độ dài mảng / chống trùng ngữ cảnh       |
| `study-validators.test.ts`                                | heuristic chống lộ đáp án, gate reading question, `spreadCorrectAnswers`                |
| `reading-question-types.test.ts`                          | slot 0 luôn `detail`, đúng allow-list CEFR, không lặp loại                              |
| `config-schema.test.ts`                                   | ràng buộc chéo min ≤ default ≤ max, cron, `validateBasicValue`, `assignPath`            |
| `tenant-permission.test.ts`                               | `assertTopicAllowed`/`assertQuizTypeAllowed`, `extractBearer`, `ADMIN_TENANT`           |
| `run-status.test.ts`                                      | `deriveRunStatus` — roll-up trạng thái run                                              |
| `bucket-key.test.ts`                                      | format `bucketKey` (điểm nối giữa 2 module khác file)                                   |
| `exclude-ids.test.ts`                                     | `parseExcludeIds` — filter best-effort, cap 200                                         |
| `concurrency.test.ts`                                     | `runWithConcurrency` — giữ thứ tự, không dừng khi lỗi, tôn trọng limit                  |
| `chance.test.ts`, `cost.test.ts`, `provider-pref.test.ts` | random có trọng số, `computeCostUsd` (null ≠ 0), round-trip provider pref               |
| `fixtures-valid.test.ts`                                  | chốt chặn: fixture câu hỏi luôn khớp schema thật                                        |

### Integration — `test/integration/` (Postgres thật, LLM/Redis mock)

| File                       | Khoá bất biến gì                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `question-pool.test.ts`    | `maxPerBucket` enforce trong transaction; `popQuestion` không phá huỷ; bucket `topicId=null` riêng |
| `pool-list.test.ts`        | `withoutTopic` thắng `topicId`; escape LIKE; phân trang ổn định                                    |
| `pool-refill-scan.test.ts` | thứ tự chống đói; **preview ≡ execution**                                                          |
| `sibling-question.test.ts` | khôi phục field khoá; guard double-submit; FK `ON DELETE SET NULL`                                 |
| `sibling-refill.test.ts`   | công thức `plannedCount`; trừ budget theo `inserted` (không phải `generated`)                      |
| `english-config.test.ts`   | **vì sao có endpoint bulk**: PATCH lẻ fail, bulk pass; hook lỗi không hỏng request                 |
| `pool-review.test.ts`      | máy trạng thái duyệt; `formatValid` do server tính; cascade khi xoá câu pool                       |
| `reading.test.ts`          | bài nửa vời không bao giờ được phục vụ; sửa `paragraphs` → deactivate câu hỏi                      |
| `tenant-apikey.test.ts`    | allow-list là replace-all; key revoke/tenant inactive → verify null                                |
| `topic.test.ts`            | cặp topic ngẫu nhiên không lặp; fallback khi exclude làm cạn pool                                  |
| `cron-tracking.test.ts`    | cộng dồn counter; roll-up trạng thái; `costUsd` null ≠ 0                                           |

### E2E — `test/e2e/` (HTTP thật)

| File                           | User journey                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `j1-tenant-serving.test.ts`    | Bot lấy câu hỏi: quiz-types → topics → pop → excludeIds → 404 → thang nới lỏng |
| `j2-tenant-permission.test.ts` | Ma trận phân quyền 2 tầng; phiên admin là super key                            |
| `j3-admin-config.test.ts`      | Chỉnh config; PATCH lẻ vs bulk; config thật sự lái hành vi refill              |
| `j4-pool-refill.test.ts`       | Preview ≡ thực thi; poll run; chi phí; nhánh LLM lỗi                           |
| `j5-review.test.ts`            | AI review → admin approve/reject; bản admin thắng bản AI                       |
| `j6-sibling.test.ts`           | Sinh sibling lẻ + refill hàng loạt; loại không hỗ trợ → 400                    |
| `j7-reading.test.ts`           | Passage → câu hỏi → tenant lấy về; sửa bài làm câu hỏi hết hạn; cascade        |
| `j8-auth-errors.test.ts`       | Vai trò tài khoản; hợp đồng envelope lỗi theo `error.code`                     |

---

## 7. Quy ước khi thêm test

1. **Đặt tên theo nghiệp vụ.** `it('bucket đầy thì bỏ qua, không overwrite')`, không phải `it('pushQuestions returns 0')`.
2. **Assert theo `error.code`, không theo `message`** ở e2e — `message` không phải hợp đồng.
3. **Không `sleep` cố định.** Dùng `waitForRun` hoặc vòng lặp có điều kiện + timeout.
4. **Mỗi test tự dựng dữ liệu của mình.** Integration dùng `beforeEach(resetDb)`; e2e journey chạy tuần tự thì dùng `beforeAll`.
5. **Phát hiện bug thì ghi vào `test/notes/FINDINGS.md`**, viết test khoá **hiện trạng** (đánh dấu `[đặc tả hiện trạng]`) kèm một `it.todo` mô tả hành vi mong muốn. Không tự sửa logic trong lúc viết test.
6. **Thêm quizType mới** → thêm factory vào `test/fixtures/pool-question.fixture.ts`; `fixtures-valid.test.ts` sẽ tự kiểm nó khớp schema.

---

## 8. Đảm bảo không tốn tiền LLM

- `generateStructuredOutput` bị thay hoàn toàn; không còn đường nào tới OpenRouter.
- Mock **throw** khi hết fixture → không có lời gọi nào lọt qua im lặng.
- `OPENROUTER_API_KEY` trong `.env.test` là chuỗi giả (`aiClient.config.ts` throw lúc import nếu thiếu biến này, nên không bỏ trống được). Nếu có lời gọi thật nào lọt ra, OpenRouter sẽ từ chối key và test đỏ.

## 9. Vấn đề đã biết

Xem `test/notes/FINDINGS.md` — các hành vi lệch tài liệu / bẫy tiềm ẩn phát hiện khi viết test, kèm test khoá hiện trạng và hướng sửa.
