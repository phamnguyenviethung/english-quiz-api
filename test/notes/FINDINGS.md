# Phát hiện trong lúc viết test

Theo nguyên tắc của plan: test ghi nhận **hành vi thật hiện tại**, bug tìm thấy được liệt kê ở
đây kèm test `.todo` tái hiện, không tự sửa logic trong đợt này.

---

## 1. Route không tồn tại trả 404 **body rỗng**, không phải error envelope

**Mức độ:** thấp–trung bình (lệch tài liệu, ảnh hưởng client).

`src/api/common/errorHandler.ts` có nhánh:

```ts
if (code === 'NOT_FOUND') {
  set.status = 404;
  return toEnvelope(ApiErrorCode.NOT_FOUND, 'Không tìm thấy route');
}
```

Nhánh này **không bao giờ chạy** với route không tồn tại. Đo thực tế:

| Path                     | Status | Body |
| ------------------------ | ------ | ---- |
| `/khong-ton-tai`         | 404    | `""` |
| `/english/khong-ton-tai` | 404    | `""` |
| `/admin/khong-ton-tai`   | 404    | `""` |
| `/api/auth/xyz`          | 404    | `""` |

**Nguyên nhân:** `src/api/api.ts` gọi `.mount(auth.handler)` **không kèm path prefix** → Better
Auth nhận mọi request không khớp route Elysia nào và tự trả 404 rỗng của nó, trước khi Elysia
kịp phát `NOT_FOUND` cho `onError`.

**Ảnh hưởng:** `docs/tenant-auth.md` §"Response envelope" khẳng định lỗi luôn có dạng
`{ success: false, error: { code, message } }` và khuyên client rẽ nhánh theo `error.code`.
Client làm đúng theo doc sẽ gặp body rỗng khi gõ sai URL → `JSON.parse` lỗi hoặc `error.code`
undefined.

**Hướng sửa (khi được duyệt):** mount Better Auth theo prefix (`.mount('/api/auth', auth.handler)`)
để request ngoài phạm vi đó rơi lại vào router Elysia. Cần kiểm tra lại đường OAuth callback +
cookie path trước khi đổi.

**Test tái hiện:** `test/e2e/j8-auth-errors.test.ts` — case `it.todo('route không tồn tại trả error envelope')`.
Case đang chạy assert đúng hành vi hiện tại (404 + body rỗng) để không khoá việc sửa sau này.

---

## 2. Lọc hết `quizTypes` trong sibling plan bị hiểu thành "không lọc" — ✅ ĐÃ SỬA

**Mức độ:** thấp (hiện không khai thác được qua API, nhưng là bẫy tiềm ẩn).

**Đã sửa:** `buildManualSiblingPlan` trả plan rỗng sớm khi filter quizType lọc ra mảng rỗng.
Test: `test/integration/sibling-refill.test.ts` — `lọc toàn quizType không hỗ trợ -> plan rỗng, không quét toàn bộ`.
Phần dưới giữ lại để tham khảo.

`siblingRefill.buildManualSiblingPlan()`:

```ts
const quizTypes = (params.filter?.quizTypes ?? SIBLING_SUPPORTED_QUIZ_TYPES)
  .filter((q) => SIBLING_SUPPORTED_SET.has(q)) as QuizType[];

const candidates = await scanBuckets({ filter: { ...params.filter, quizTypes }, ... });
```

Nếu caller truyền toàn quizType KHÔNG hỗ trợ (vd `['odd-one-out','paragraph']`), `quizTypes`
thành `[]`. Nhưng `scanBuckets` dùng `hasFilterValues()` — mảng rỗng nghĩa là **"không lọc
chiều này"**. Kết quả: thay vì trả 0 bucket, nó quét **toàn bộ** quizType đang bật.

**Vì sao chưa thành sự cố:** `admin.controller.toSiblingBucketFilter()` ném
`BusinessLogicException` (→ 400) cho mọi quizType không hỗ trợ, nên request thật không bao giờ
tới được nhánh này. Đây là lỗi ở lớp phòng thủ thứ hai, không phải lớp thứ nhất.

**Hướng sửa (khi được duyệt):** trả về plan rỗng sớm khi `quizTypes.length === 0` mà
`params.filter?.quizTypes` có phần tử — phân biệt "không truyền filter" với "truyền filter và
lọc ra rỗng".

**Test khoá hiện trạng:** `test/integration/sibling-refill.test.ts` —
`it('[đặc tả hiện trạng] lọc hết quizType -> mảng rỗng bị hiểu thành "không lọc"')`.

---

# Đã sửa (phát hiện khi port sang my-minigame-api)

Mỗi mục có test tái hiện: fail với code cũ, pass sau khi sửa.

## 3. Refill on-demand bị kẹt vĩnh viễn sau một job fail — ✅ ĐÃ SỬA

**Mức độ:** trung bình. `runOnDemandRefill` add job với `jobId` cố định
`refill_{lvl}_{topic}_{type}`, queue để `removeOnFail: 100` → job fail nằm lại trong failed set,
BullMQ bỏ qua mọi `add` cùng id → bucket không bao giờ được refill on-demand nữa (hàm vẫn trả
`enqueued: true`). Bucket `topicId = null` không được cron quét nên mất hẳn đường refill.

**Sửa:** `buildOnDemandRefillJob` dùng `deduplication: { id }` (nhả khi completed hoặc failed).
**Test:** `test/unit/on-demand-refill-job.test.ts`.

## 4. Chi phí sibling refill luôn `null`, và tính giá nhầm model — ✅ ĐÃ SỬA

**Mức độ:** trung bình. `processSiblingBucket` tra giá bằng `usage.model` — tên OpenRouter trả về
đã bị `aiClient.config.ts` cắt prefix provider và không có suffix `:nitro`/`:floor` → không bao
giờ khớp `ai_models.modelId` → `costUsd` luôn null. Ngoài ra token của cả bucket bị tính theo
model của câu gốc **cuối cùng**, dù mỗi câu gốc có thể random model khác. Test cũ không bắt được
vì `mockLLM` mặc định trả `usage.model = call.model` (id đầy đủ).

**Sửa:** `generateSiblingsForSource` trả `configuredModel` + `costUsd` tính theo model đã cấu hình
cho từng lời gọi; bucket cộng bằng `sumCostUsd` (null-aware).
**Test:** `test/integration/sibling-refill.test.ts` — describe `processSiblingBucket — chi phí theo model đã cấu hình`.

## 5. `GET /english/pool/pop` bỏ qua allow-list quizType của tenant — ✅ ĐÃ SỬA

**Mức độ:** trung bình (phân quyền). Pop chỉ `assertTopicAllowed`; query random trên mọi quizType
→ tenant bị giới hạn quizType vẫn nhận câu ngoài allow-list (trái `docs/tenant-auth.md`).

**Sửa:** `popQuestion(..., allowedQuizTypes)` lọc `quizType IN (...)`; allow-list rỗng → null → 404.
**Test:** `test/e2e/j2-tenant-permission.test.ts` — 3 case `pop ...` trong describe allow-list quizType.

## 6. Job question-gen xoá Redis lock mà nó không giữ — ✅ ĐÃ SỬA

**Mức độ:** thấp. `processQuestionGenJob` `DEL question-pool:lock:*` trong `finally`, nhưng lock
chỉ do luồng sibling SET (NX) → có thể nhả lock của một lượt sibling đang chạy trên cùng bucket.

**Sửa:** bỏ phần `DEL` (chống vượt sức chứa vẫn do `pushQuestions` re-check trong transaction).
**Test:** `test/integration/question-gen-lock.test.ts`.

## 7. Provider routing schedule/manual không được validate — ✅ ĐÃ SỬA

**Mức độ:** thấp. `readingProvider` đi qua `fromProviderPreferences`, còn `scheduleProvider` /
`manualProvider` (jsonb) lưu nguyên → `maxPrice` âm/không phải số, provider trùng… chỉ lộ ra khi
OpenRouter từ chối ở mọi lần sinh câu.

**Sửa:** `normalizeProviderPreferencesJson` (cùng rule với reading) trong `createModel`/`updateModel`.
**Test:** `test/unit/provider-pref.test.ts`, `test/integration/ai-model-provider.test.ts`.
