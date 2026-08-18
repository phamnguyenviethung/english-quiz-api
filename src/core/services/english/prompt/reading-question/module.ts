import type { ReadingQuestionType } from '../../readingQuestionTypes';

/**
 * Prompt chuyên biệt cho 1 quiz type. Mỗi lần sinh 1 câu chỉ render đúng 1 module,
 * nên chỗ này được viết dày (có ví dụ, công thức distractor, lỗi thường gặp) mà không
 * làm phình prompt như bản playbook chung trước đây.
 */
export interface ReadingQuestionTypeModule {
  type: ReadingQuestionType;
  /** Vai trò model đóng, 1 câu. */
  role: string;
  /** Evidence bắt buộc phải có trong bài. Thiếu thì model phải báo không sinh được. */
  evidence: string;
  /** Các bước thực thi. */
  method: string[];
  /** Công thức tạo distractor riêng cho type này. */
  distractors: string[];
  /** Self-check chỉ áp cho type này (nối sau self-check chung). */
  selfCheck: string[];
  /** Ví dụ cấu trúc — model không được copy nội dung. */
  example: string;
  /** Lỗi model hay mắc ở đúng type này. */
  pitfalls: string[];
}
