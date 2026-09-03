# Phát hiện trong lúc viết test (chưa sửa)

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

## 2. Lọc hết `quizTypes` trong sibling plan bị hiểu thành "không lọc"

**Mức độ:** thấp (hiện không khai thác được qua API, nhưng là bẫy tiềm ẩn).

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
