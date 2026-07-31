/**
 * Global exception filter. Every thrown error leaves the API as the canonical
 * error envelope `{ error: { code, message, details? }, meta }`. Maps:
 *   ApiException     → its own code/status
 *   ZodError         → VALIDATION_FAILED (400) + field details
 *   HttpException    → status-derived code
 *   anything else    → INTERNAL_ERROR (500), message hidden
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ApiErrorCode, ApiErrorDetail, ApiFailure } from "@pintle/contracts";
import { ZodError } from "zod";

import { ApiException } from "./api-exception.js";
import { nowIso, requestIdOf } from "./request-id.js";

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "AUTH_REQUIRED",
  403: "TENANT_FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest();
    const reply = http.getResponse();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = "INTERNAL_ERROR";
    let message = "Internal server error";
    let details: ApiErrorDetail[] | undefined;

    if (exception instanceof ApiException) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = "VALIDATION_FAILED";
      message = "Request validation failed";
      details = exception.issues.map((i) => ({
        field: i.path.join(".") || "(root)",
        issue: i.message,
      }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? "INTERNAL_ERROR";
      const resp = exception.getResponse();
      message =
        typeof resp === "string"
          ? resp
          : ((resp as { message?: unknown }).message?.toString() ?? exception.message);
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId: requestIdOf(req) }, "unhandled exception");
    }

    const body: ApiFailure = {
      error: { code, message, ...(details ? { details } : {}) },
      meta: { requestId: requestIdOf(req), timestamp: nowIso() },
    };

    reply.status(status).send(body);
  }
}
