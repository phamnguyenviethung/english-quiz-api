// Mã lỗi máy đọc được, trả trong error envelope { success:false, error:{ code, message } }.
// Client dựa vào `code` để xử lý (ổn định), `message` chỉ để hiển thị/log.
export const ApiErrorCode = {
  VALIDATION: 'VALIDATION',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_ERROR: 'BUSINESS_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
