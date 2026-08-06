# English Runtime Config

> Mục đích: mô tả hệ thống config runtime dành riêng cho module English, để developer hoặc AI agent biết khi nào chỉnh DB-backed config, khi nào giữ logic trong code, và phải verify những gì.

## 1. Tổng Quan

English Runtime Config lưu các giá trị vận hành quiz infra trong Postgres theo mô hình typed EAV record.

Mỗi row trong `english_config_records` là một setting riêng:

- `recordKey`: unique key, ví dụ `question_pool.maxPerBucket`
- `namespace`: nhóm snapshot runtime, ví dụ `question_pool`
- `path`: field trong namespace, ví dụ `maxPerBucket`
- `recordType`: lấy từ bảng `english_config_record_types`
- typed value columns: `valueText`, `valueNumber`, `valueBoolean`, `valueJson`

Config hiện phục vụ **4 namespace**:

- Question pool (`question_pool`) — cap/threshold pool + manual-fill
- Quiz distribution (`quiz_distribution`) — weighted quiz type
- Job flags (`job_flags`) — bật/tắt cron job gen + limit câu mỗi lần refill
- Pool refill schedule (`pool_refill_schedule`) — lịch chạy cron của scheduled pool-refill

Prompt text, prompt examples, và Zod question schemas không thuộc config.

Một số recordKey có **side effect ngoài in-memory snapshot** khi update — ví dụ đổi `pool_refill_schedule.items` sẽ reconcile lại BullMQ job schedulers ngay (thêm/xoá lịch chạy). Cơ chế: `englishConfig.service.ts` export `onEnglishConfigChanged(recordKey, hook)`, module quan tâm (ví dụ `pool-refill.job.ts`) tự đăng ký hook lúc boot; `updateEnglishConfig()` gọi mọi hook đã đăng ký cho `recordKey` đó ngay sau khi refresh snapshot. Config service không import ngược vào BullMQ/queue nào — giữ layering 1 chiều.

## 2. File Chính

| File                                                  | Vai trò                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/db/schema/main.ts`                          | Khai báo `english_config_record_types` và `english_config_records` |
| `src/core/services/english/englishConfig.defaults.ts` | Defaults, Zod schemas, record definitions, validation/UI metadata  |
| `src/core/services/english/englishConfig.service.ts`  | Seed DB, validate, load snapshot, update/reset record              |
| `src/index.ts`                                        | Gọi `ensureEnglishConfigSeeded()` trước khi start cron/API         |
| `src/api/routes/english.route.ts`                     | Endpoint `/english/config*` (get snapshot/records, patch, reset)   |

## 3. DB Schema

### `english_config_record_types`

Seed các type cơ bản:

| Key       | Ý nghĩa                    |
| --------- | -------------------------- |
| `str`     | Short text                 |
| `num`     | Integer hoặc decimal       |
| `boolean` | On/off flag                |
| `arr`     | Repeated structured values |
| `obj`     | Grouped structured fields  |

### `english_config_records`

| Column                   | Ý nghĩa                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `recordKey`              | Unique key, ví dụ `question_pool.maxPerBucket`                |
| `namespace`              | Runtime snapshot group, ví dụ `question_pool`                 |
| `path`                   | Field path trong namespace, ví dụ `maxPerBucket` hoặc `items` |
| `category`               | Nhóm hiển thị: `pool`, `jobs`                                 |
| `label`, `description`   | Text hiển thị cho admin                                       |
| `recordTypeId`           | FK đến `english_config_record_types.id`                       |
| `valueText`              | Current value cho `str`                                       |
| `valueNumber`            | Current value cho `num`                                       |
| `valueBoolean`           | Current value cho `boolean`                                   |
| `valueJson`              | Current value cho `arr` hoặc `obj`                            |
| `defaultText/Number/...` | Default value theo cùng typed column                          |
| `validation`             | Metadata validate cơ bản theo type                            |
| `uiSchema`               | Metadata render typed UI controls                             |
| `sortOrder`              | Thứ tự hiển thị                                               |
| `createdAt`, `updatedAt` | Timestamp                                                     |

Không có revision table, `changeNote`, `changedBy`, hoặc `isActive` trong v1 này.

Index:

- Unique index trên `recordKey`
- Index thường trên `category`, `namespace`, `recordTypeId`

Không dùng JSONB GIN index vì runtime chỉ fetch theo record/group, không query sâu trong payload.

## 4. Runtime Lifecycle

1. App start gọi `ensureEnglishConfigSeeded()`.
2. Service seed record types và config records nếu thiếu.
3. Nếu record đã có, service chỉ sync metadata/default/validation/UI schema; không overwrite current value admin đã chỉnh.
4. `refreshEnglishConfig()` load records vào in-memory snapshot.
5. Snapshot builder đọc đúng typed value column theo `recordType`.
6. Runtime đọc config bằng `getEnglishConfigSnapshot()` để tránh DB query trong hot path.
7. UI save/reset gọi `updateEnglishConfig()` hoặc `resetEnglishConfigToDefault()`, validate rồi refresh snapshot ngay.

Nếu DB value thiếu hoặc invalid, snapshot dùng default cho phần config đó và log warning.

## 5. Config Records

### `question_pool`

Các record:

- `question_pool.maxPerBucket`
- `question_pool.refillThresholdRatio`
- `question_pool.perBucketGenerationCap` (`num`, default `5`): trần số câu sinh trong 1 lần gọi LLM cho 1 bucket. Áp dụng cho mọi cơ chế refill (on-demand, scheduled, manual) — thay hardcode `5` cũ.
- `question_pool.manualFillMinCount`
- `question_pool.manualFillMaxCount`
- `question_pool.manualFillDefaultCount`
- `question_pool.manualFillConcurrency`

### `quiz_distribution`

Record:

- `quiz_distribution.items`

Mỗi item có `quizType`, `weight`, `enabled`. Runtime filter `enabled=true` và `weight>0`, sau đó normalize theo tổng weight. Tổng weight không bắt buộc bằng 100.

### `job_flags`

Các record:

- `job_flags.questionGenEnabled` (`boolean`, default `true`): tắt → `ensurePoolFilled` không enqueue job refill khi pool cạn (trigger qua `POST /english/pool/fill`).
- `job_flags.poolRefillEnabled` (`boolean`, default `true`): tắt → parent worker bỏ qua các lần scheduled refill (xem `pool_refill_schedule.items`), không tạo tracking run.
- `job_flags.poolRefillMaxQuestionsPerRun` (`num`, default `50`): giới hạn tổng số câu generate trong một lần Pool-Refill **scheduled**. Scan vẫn quét đủ bucket nhưng dừng tạo child khi tổng câu cần generate chạm trần (tối ưu cost AI). **Không** áp dụng cho manual refill (`POST /admin/pool/refill`) — hành động admin chủ động, chấp nhận chi phí.

### `pool_refill_schedule`

Record:

- `pool_refill_schedule.items` (`arr`, default 3 mốc `05:00/12:00/20:00` Asia/Ho_Chi_Minh)

Mỗi item có `name` (unique, dùng làm BullMQ `jobSchedulerId`) và `cron` (cron expression, validate bằng `cron-parser` ngay ở Zod schema — sai cú pháp → 400 khi PATCH). Đổi giá trị này reconcile BullMQ job schedulers ngay lập tức, không cần restart (xem §1).

Manual-fill (`/admin/pool/refill`) không có flag chặn — chủ động trigger, dùng `ADMIN_API_KEY` riêng nên không cần feature flag.

## 6. API

Service này không có UI riêng — config được thao tác qua HTTP API (prefix `/english`):

- `GET /config` — snapshot runtime hiện tại (đọc từ memory).
- `GET /config/records` — list toàn bộ config records (kèm value/default/validation/uiSchema) theo category/sort order.
- `PATCH /config/:recordKey` body `{ value }` — validate rồi update 1 record, refresh snapshot ngay.
- `POST /config/:recordKey/reset` — ghi default typed value qua cùng validation path.

Tất cả các route này chỉ dùng được với `ADMIN_API_KEY` (xem `docs/tenant-auth.md`). Server-side validation trong service là source of truth. `uiSchema`/`validation` metadata vẫn được trả về để client (nếu có) render typed controls.

## 7. Quy Tắc Khi Thêm Config Mới

1. Thêm default vào `EnglishConfigDefaults` nếu cần namespace mới hoặc field mới.
2. Thêm hoặc extend Zod schema trong `englishConfig.defaults.ts`.
3. Thêm record definition vào `ENGLISH_CONFIG_RECORD_DEFINITIONS`.
4. Chọn đúng `recordType`: `str`, `num`, `boolean`, `arr`, hoặc `obj`.
5. Thêm `validation` và `uiSchema` để UI render typed controls, không dùng JSON editor.
6. Wire runtime đọc `getEnglishConfigSnapshot()` thay vì đọc DB trực tiếp.
7. Update docs này và docs nghiệp vụ liên quan.
8. Verify type/build/format checks.

## 8. Không Nên Đưa Vào Config V1

- Prompt text dài hoặc prompt examples
- Zod question output schema
- Field contract giữa StudyService và handler
- Config theo user/end-user, vì service là global quiz-infra config (không quản lý end-user)

## 9. Checklist Khi Debug

- DB đã có `english_config_record_types` và `english_config_records` chưa?
- App start đã gọi `ensureEnglishConfigSeeded()` chưa?
- Record type có được seed đủ `str`, `num`, `boolean`, `arr`, `obj` không?
- Record value có đang nằm đúng typed column không?
- Zod namespace schema có reject snapshot sau khi assign record không?
- Snapshot đã refresh sau khi `PATCH`/`reset` chưa?
- Runtime module đang đọc `getEnglishConfigSnapshot()` hay còn hardcode?
