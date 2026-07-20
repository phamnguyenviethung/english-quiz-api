export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiList<T> extends ApiSuccess<T[]> {
  total: number;
}

export interface ApiError {
  success: false;
  message: string;
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function list<T>(data: T[]): ApiList<T> {
  return { success: true, data, total: data.length };
}

export function notFound(message = 'Không tìm thấy'): Response {
  return Response.json({ success: false, message } satisfies ApiError, { status: 404 });
}
