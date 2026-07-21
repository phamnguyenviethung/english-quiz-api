import { ApiErrorCode } from '@/api/common/errorCodes';

// Base exception mang HTTP status + error code máy đọc được. Global error handler
// (src/api/common/errorHandler.ts) map các exception này sang envelope
// { success:false, error:{ code, message } }.
class HttpException extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpException';
    this.status = status;
    this.code = code;
  }
}

// Lỗi nghiệp vụ chung → 400 Bad Request.
class BusinessLogicException extends HttpException {
  constructor(message: string) {
    super(400, ApiErrorCode.BUSINESS_ERROR, message);
    this.name = 'BusinessLogicException';
  }
}

// Thiếu / sai credential → 401 Unauthorized.
class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(401, ApiErrorCode.UNAUTHORIZED, message);
    this.name = 'UnauthorizedException';
  }
}

// Có credential nhưng không đủ quyền (scope / resource) → 403 Forbidden.
class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(403, ApiErrorCode.FORBIDDEN, message);
    this.name = 'ForbiddenException';
  }
}

// Không tìm thấy resource → 404 Not Found.
class NotFoundException extends HttpException {
  constructor(message = 'Not found') {
    super(404, ApiErrorCode.NOT_FOUND, message);
    this.name = 'NotFoundException';
  }
}

// Xung đột (unique violation) → 409 Conflict.
class ConflictException extends HttpException {
  constructor(message = 'Conflict') {
    super(409, ApiErrorCode.CONFLICT, message);
    this.name = 'ConflictException';
  }
}

export {
  HttpException,
  BusinessLogicException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException
};
