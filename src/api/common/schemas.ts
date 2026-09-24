import { t } from 'elysia';
import { ENG_LEVELS, QUIZ_TYPES, READING_PASSAGE_TYPES } from '@/core/services/english/questionTypes';
import { MODEL_QUANTIZATIONS } from '@/core/db/schema/main';

// TypeBox schema dùng chung ở request boundary. Xây từ source-of-truth domain
// (ENG_LEVELS, QUIZ_TYPES) để validation declarative — Elysia tự trả 400 khi sai,
// không cần check thủ công trong handler.

// Array.prototype.map() luôn trả về T[] (mất tuple arity), nên t.Union(arr.map(t.Literal))
// bị TypeScript suy ra Static<> = never thay vì literal union thật — vô hại lúc runtime
// (Elysia vẫn validate đúng) nhưng làm hỏng type-check tĩnh khi dùng schema này trong
// `response` (handler trả literal union thật sẽ bị báo lỗi không khớp "never[]").
// ToLiteralTuple dùng mapped type đệ quy (không qua .map()) để giữ đúng arity từng phần tử.
type ToLiteralTuple<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest]
  ? Head extends string
    ? [ReturnType<typeof t.Literal<Head>>, ...ToLiteralTuple<Rest>]
    : never
  : [];

function toLiterals<const T extends readonly string[]>(values: T): ToLiteralTuple<T> {
  return values.map((v) => t.Literal(v)) as ToLiteralTuple<T>;
}

export const EngLevelSchema = t.Union(toLiterals(ENG_LEVELS));

export const QuizTypeSchema = t.Union(toLiterals(QUIZ_TYPES));

// 'daily' (mặc định, narrative) | 'academic' (expository) — xem READING_PASSAGE_TYPES.
export const ReadingPassageTypeSchema = t.Union(toLiterals(READING_PASSAGE_TYPES));

export const OptionCountSchema = t.Union([t.Literal(3), t.Literal(4), t.Literal(5)]);

// optionCount cho pool fill chỉ nhận 4 hoặc 5 (khớp questionPoolTrigger.ensurePoolFilled).
export const PoolOptionCountSchema = t.Union([t.Literal(4), t.Literal(5)]);

// Query `beginner=true` ở các endpoint phục vụ tenant: chỉ lấy nội dung beginner (≤ B1, ≤ 4 đáp án).
// Bỏ trống/false = chỉ nội dung thường — hai luồng không bao giờ trộn. Xem docs/beginner.md.
export const BeginnerQuerySchema = t.Optional(
  t.BooleanString({
    description: 'true = chỉ nội dung beginner (≤ B1, ≤ 4 đáp án). Bỏ trống/false = chỉ nội dung thường.'
  })
);

// Filter bucket theo đối tượng ở các endpoint admin preview/refill. Bỏ trống = cả hai.
export const BucketAudienceSchema = t.Union([t.Literal('standard'), t.Literal('beginner')], {
  description: "'standard' = chỉ bucket thường, 'beginner' = chỉ bucket beginner. Bỏ trống = cả hai."
});

// Path param `:id` dạng số — t.Numeric() auto-coerce string→number và reject phi số → 400.
export const IdParam = t.Object({ id: t.Numeric() });

// Provider routing preferences của OpenRouter (pass-through thẳng vào chatRequest.provider).
// Khớp ProviderPreferencesJson ở schema/main.ts — sửa một chỗ thì sửa cả hai.
export const ProviderPreferencesSchema = t.Object({
  order: t.Optional(t.Array(t.String(), { description: 'Thứ tự ưu tiên provider slug, vd ["google-vertex"].' })),
  allowFallbacks: t.Optional(t.Boolean({ description: 'false = chỉ dùng provider trong order, lỗi thì fail luôn.' })),
  requireParameters: t.Optional(t.Boolean()),
  dataCollection: t.Optional(t.Union([t.Literal('allow'), t.Literal('deny')])),
  ignore: t.Optional(t.Array(t.String())),
  only: t.Optional(t.Array(t.String())),
  quantizations: t.Optional(t.Array(t.Union(toLiterals(MODEL_QUANTIZATIONS)))),
  sort: t.Optional(t.String({ description: 'Chiến lược sort khi không set order, vd "price" | "throughput".' })),
  maxPrice: t.Optional(
    t.Object(
      {
        prompt: t.Optional(t.String()),
        completion: t.Optional(t.String()),
        request: t.Optional(t.String()),
        image: t.Optional(t.String()),
        audio: t.Optional(t.String())
      },
      { description: 'Trần giá USD trên 1 triệu token.' }
    )
  ),
  zdr: t.Optional(t.Boolean({ description: 'true = chỉ dùng endpoint Zero Data Retention.' }))
});
