import { t } from 'elysia';
import { ENG_LEVELS, QUIZ_TYPES } from '@/core/services/english/questionTypes';

// TypeBox schema dùng chung ở request boundary. Xây từ source-of-truth domain
// (ENG_LEVELS, QUIZ_TYPES) để validation declarative — Elysia tự trả 400 khi sai,
// không cần check thủ công trong handler.

export const EngLevelSchema = t.Union(ENG_LEVELS.map((level) => t.Literal(level)));

export const QuizTypeSchema = t.Union(QUIZ_TYPES.map((type) => t.Literal(type)));

export const OptionCountSchema = t.Union([t.Literal(3), t.Literal(4), t.Literal(5)]);

// optionCount cho pool fill chỉ nhận 4 hoặc 5 (khớp questionPoolTrigger.ensurePoolFilled).
export const PoolOptionCountSchema = t.Union([t.Literal(4), t.Literal(5)]);

// Path param `:id` dạng số — t.Numeric() auto-coerce string→number và reject phi số → 400.
export const IdParam = t.Object({ id: t.Numeric() });
