/**
 * Domain error carrying a canonical ApiErrorCode. The global exception filter
 * turns this (and everything else) into the common error envelope.
 */
import type { ApiErrorCode, ApiErrorDetail } from "@pintle/contracts";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTH_REQUIRED: 401,
  TENANT_FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiException extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly details?: ApiErrorDetail[];

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = "ApiException";
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.details = details;
  }

  static authRequired(message = "Authentication required") {
    return new ApiException("AUTH_REQUIRED", message);
  }

  static tenantForbidden(message = "No access to this tenant") {
    return new ApiException("TENANT_FORBIDDEN", message);
  }

  static notFound(message = "Not found") {
    return new ApiException("NOT_FOUND", message);
  }
}
