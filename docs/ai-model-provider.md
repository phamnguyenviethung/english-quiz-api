# AI Model — Provider Routing

Mỗi model trong `ai_models` có thể cấu hình **provider routing** riêng cho từng ngữ cảnh sinh nội dung. Object này được truyền thẳng vào `chatRequest.provider` khi gọi OpenRouter (shape `ProviderPreferencesJson` ở `core/db/schema/main.ts`).

## Ba ngữ cảnh (`ModelContext`)

| Context    | Cột bật/tắt       | Dùng ở đâu                                |
| ---------- | ----------------- | ----------------------------------------- |
| `schedule` | `scheduleEnabled` | Cron pool-refill + on-demand backstop     |
| `manual`   | `manualEnabled`   | Admin bấm refill question pool            |
| `reading`  | `readingEnabled`  | Sinh reading passage (cả cron lẫn manual) |

## Hai cách lưu, một shape API

Đây là điểm dễ nhầm nhất của phần này:

- `schedule` / `manual` lưu ở cột **jsonb** `scheduleProvider` / `manualProvider` trên `ai_models`
- `reading` lưu **normalize** ở 2 bảng `ai_model_provider_prefs` + `ai_model_provider_pref_values`

**API không phản ánh khác biệt đó.** Cả 3 đều nhận/trả cùng một object lồng nhau trong body/response của `/admin/models`. Dashboard dùng chung component `ProviderPreferencesFields` cho cả 3 tab. Normalize thuần tuý là chuyện storage.

Lý do chỉ reading normalize: `ProviderPreferences` có shape cố định nên lưu quan hệ thì query và ràng buộc được ở DB thay vì blob. Reading là feature mới nên làm đúng ngay từ đầu; 2 context cũ giữ jsonb để không phải migrate data đang chạy.

## Schema

```
ai_model_provider_prefs
  id, modelRefId FK ai_models, context   -- hiện chỉ ghi 'reading'
  allowFallbacks, requireParameters, dataCollection, sort, zdr
  maxPricePrompt / Completion / Request / Image / Audio   (double precision)
  UNIQUE (modelRefId, context)

ai_model_provider_pref_values
  id, prefRefId FK
  kind    -- 'order' | 'ignore' | 'only' | 'quantization'
  value, position          -- position chỉ có ý nghĩa với kind='order'
  UNIQUE (prefRefId, kind, value)
```

Cột `context` hiện luôn là `'reading'`. Giữ nó (và unique index gồm nó) để sau muốn chuyển nốt `schedule`/`manual` sang bảng thì chỉ cần thêm row, không phải đổi schema.

Dùng `text()` chứ không `pgEnum` cho `context`/`kind`/`dataCollection` — nhất quán với toàn repo (`engLevel`, `quizType`, `status` đều là `text()`); validate ở service layer bằng const array.

`maxPrice.*` lưu số (`double precision`) cho đúng kiểu, còn `ProviderPreferencesJson.maxPrice` khai báo `string` theo SDK OpenRouter — mapper lo đổi qua lại.

## Mapper

`core/services/ai/providerPref.mapper.ts` là chỗ duy nhất biết cả 2 dạng:

- `toProviderPreferences(pref, values)` → object cho SDK. Trả `undefined` khi model chưa cấu hình gì, khớp đúng chỗ caller đang truyền `?? undefined`.
- `fromProviderPreferences(input)` → `{ columns, values }` để ghi xuống 2 bảng. Throw `BusinessLogicException` (→ 400) khi `dataCollection` ngoài `allow|deny`, `quantizations` ngoài `MODEL_QUANTIZATIONS`, hoặc `maxPrice.*` không phải số không âm.

## Đọc/ghi

`aiModel.service.ts`:

- `getReadingProvidersByModelRefIds(ids)` — **batch 2 query** cho N model, tránh N+1 khi `getStudyModelsForContext('reading')` resolve cả pool
- `getReadingProvider(id)` — bản 1 model
- `setReadingProvider(id, prefs | null)` — **replace toàn bộ**, không merge (giống `setTopicAccess`). `null` hoặc object rỗng → xoá sạch row của model đó
- `getAllModelsWithReadingProvider()` / `getModelByIdWithReadingProvider(id)` — bản cho admin UI. `getAllModels()`/`getModelById()` giữ nguyên signature cũ vì các call site sinh nội dung không cần pref này

Controller `/admin/models` POST/PATCH tách `readingProvider` khỏi payload update model rồi gọi `setReadingProvider` riêng, sau đó trả về bản đã assemble lại.
