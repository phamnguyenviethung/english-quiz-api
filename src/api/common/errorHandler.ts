import { Elysia } from 'elysia';
import logger from '@/configs/logger.config';
import { HttpException } from '@/core/exceptions';
import { ApiErrorCode } from './errorCodes';
import type { ApiError } from './response';

// Trích PG error code (23505 = unique violation) từ error hoặc error.cause.
function getPgCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  if ('code' in err && typeof err.code === 'string') return err.code;
  if ('cause' in err && err.cause && typeof err.cause === 'object' && 'code' in err.cause) {
    const code = (err.cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function toEnvelope(code: ApiErrorCode, message: string): ApiError {
  return { success: false, error: { code, message } };
}

/**
 * Global error handler — map exception sang HTTP với envelope
 * { success:false, error:{ code, message } } (đồng bộ src/api/common/response.ts).
 *
 * - HttpException → error.status + error.code (đã gán sẵn theo subclass)
 * - PG 23505 (unique) → 409 / CONFLICT
 * - Elysia VALIDATION (TypeBox) → 400 / VALIDATION
 * - NOT_FOUND (route không tồn tại) → 404 / NOT_FOUND
 * - còn lại → 500 / INTERNAL_ERROR (log stack)
 */
export const errorHandler = new Elysia({ name: 'error-handler' }).onError({ as: 'global' }, ({ code, error, set }) => {
  // Exception có status + code rõ ràng.
  if (error instanceof HttpException) {
    set.status = error.status;
    return toEnvelope(error.code, error.message);
  }

  // Unique violation từ Postgres.
  if (getPgCode(error) === '23505') {
    set.status = 409;
    return toEnvelope(ApiErrorCode.CONFLICT, 'Resource đã tồn tại (conflict)');
  }

  // Lỗi validation của Elysia (TypeBox schema).
  if (code === 'VALIDATION') {
    set.status = 400;
    const message = error instanceof Error ? error.message : 'Dữ liệu không hợp lệ';
    return toEnvelope(ApiErrorCode.VALIDATION, message);
  }

  // Route không tồn tại.
  if (code === 'NOT_FOUND') {
    set.status = 404;
    return toEnvelope(ApiErrorCode.NOT_FOUND, 'Không tìm thấy route');
  }

  // Lỗi không lường trước → 500, log stack để debug.
  set.status = 500;
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`[API] Unhandled error (code=${code}): ${error instanceof Error ? (error.stack ?? message) : message}`);
  return toEnvelope(ApiErrorCode.INTERNAL_ERROR, 'Internal server error');
});
