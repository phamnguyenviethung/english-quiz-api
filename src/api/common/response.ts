import type { ApiErrorCode } from './errorCodes';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiList<T> extends ApiSuccess<T[]> {
  total: number;
}

export interface ApiError {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

// Envelope thành công cho một resource.
export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

// Giống ok() nhưng dùng cho resource vừa tạo (handler set status 201 kèm theo).
export function created<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

// Envelope thành công cho danh sách; total = số phần tử trả về.
export function list<T>(data: T[]): ApiList<T> {
  return { success: true, data, total: data.length };
}
