import { t } from 'elysia';
import { ENG_LEVELS, QUIZ_TYPES } from '@/core/services/english/questionTypes';

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

export const OptionCountSchema = t.Union([t.Literal(3), t.Literal(4), t.Literal(5)]);

// optionCount cho pool fill chỉ nhận 4 hoặc 5 (khớp questionPoolTrigger.ensurePoolFilled).
export const PoolOptionCountSchema = t.Union([t.Literal(4), t.Literal(5)]);

// Path param `:id` dạng số — t.Numeric() auto-coerce string→number và reject phi số → 400.
export const IdParam = t.Object({ id: t.Numeric() });
