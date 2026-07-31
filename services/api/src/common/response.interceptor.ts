/**
 * Global success interceptor. Wraps every handler return value in the
 * canonical success envelope `{ data, meta: { requestId, timestamp } }`.
 * Handlers return bare data; they never build envelopes. Errors bypass this
 * and are handled by AllExceptionsFilter.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiSuccess } from "@pintle/contracts";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

import { SKIP_ENVELOPE_KEY } from "./decorators.js";
import { nowIso, requestIdOf } from "./request-id.js";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return next.handle(); // streaming (SSE) — raw events

    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { requestId: requestIdOf(req), timestamp: nowIso() },
      })),
    );
  }
}
