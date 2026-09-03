import _ from 'lodash';
import { QUESTION_SCHEMA_BY_TYPE } from './prompt/question-schema-map';
import { SIBLING_LOCK_FIELDS_BY_TYPE } from './prompt/sibling-prompt';
import type { SiblingQuizType } from './questionTypes';

/**
 * Phần thuần (không DB, không LLM) của luồng sinh câu tương tự: parse, chuẩn hoá, chữ ký
 * ngữ cảnh và validate candidate. Tách khỏi siblingQuestion.service để test trực tiếp được
 * các luật này mà không phải dựng cả một lượt gọi model.
 */

export type CandidateCheck =
  { ok: true; data: Record<string, unknown>; warnings: string[] } | { ok: false; reason: string };

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/** Chuỗi "phần ngữ cảnh" của một câu — dùng để bắt sibling không thật sự đổi so với câu gốc. */
export function contextSignature(quizType: SiblingQuizType, data: Record<string, unknown>): string {
  const parts: string[] = [normalizeText(data.exampleSentence)];
  switch (quizType) {
    case 'fillblank':
    case 'verb-use-match':
      parts.push(normalizeText(data.sentence));
      break;
    case 'conversation':
      parts.push(normalizeText(Array.isArray(data.dialogueLines) ? data.dialogueLines.join(' | ') : ''));
      break;
    case 'description':
      parts.push(normalizeText(data.description));
      break;
    default:
      // vocab/phrase/idiom/slang/synonym: không có câu ngữ cảnh riêng → dựa vào bộ distractor.
      parts.push(normalizeText(Array.isArray(data.wrongAnswers) ? data.wrongAnswers.join(' | ') : ''));
      break;
  }
  return parts.join('||');
}

/**
 * Validate một candidate sibling: đúng schema loại, độ dài mảng song song, khóa term nguyên
 * văn (khôi phục cưỡng bức nếu model lỡ đổi), và thật sự khác câu gốc.
 */
export function validateCandidate(
  quizType: SiblingQuizType,
  source: Record<string, unknown>,
  candidate: unknown,
  optionCount: number
): CandidateCheck {
  const schema = QUESTION_SCHEMA_BY_TYPE[quizType];
  if (!schema) return { ok: false, reason: `Không có schema cho quizType "${quizType}"` };

  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'candidate không phải object' };

  // Khôi phục cưỡng bức các key khóa từ câu gốc trước khi parse.
  const warnings: string[] = [];
  const merged: Record<string, unknown> = { ...(candidate as Record<string, unknown>) };
  for (const key of SIBLING_LOCK_FIELDS_BY_TYPE[quizType]) {
    if (!_.isEqual(merged[key], source[key])) {
      warnings.push(`Model đổi field khóa "${key}" (${JSON.stringify(merged[key])}) → khôi phục từ câu gốc`);
      merged[key] = source[key];
    }
  }

  const parsed = schema.safeParse(merged);
  if (!parsed.success) return { ok: false, reason: `Sai schema "${quizType}": ${parsed.error.message.slice(0, 300)}` };
  const data = parsed.data as Record<string, unknown>;

  const wrongLen = Array.isArray(data.wrongAnswers) ? data.wrongAnswers.length : -1;
  if (wrongLen !== optionCount - 1) {
    return { ok: false, reason: `wrongAnswers có ${wrongLen} phần tử, cần ${optionCount - 1}` };
  }
  for (const arrKey of ['wrongAnswerExplanations', 'optionTranslations'] as const) {
    if (data[arrKey] !== undefined) {
      const len = Array.isArray(data[arrKey]) ? (data[arrKey] as unknown[]).length : -1;
      if (len !== optionCount - 1) {
        return { ok: false, reason: `${arrKey} có ${len} phần tử, cần ${optionCount - 1}` };
      }
    }
  }

  if (contextSignature(quizType, data) === contextSignature(quizType, source)) {
    return { ok: false, reason: 'Ngữ cảnh trùng câu gốc — model không thật sự đổi' };
  }

  return { ok: true, data, warnings };
}
