/**
 * Request-scoped tenant context. The AuthGuard attaches a resolved
 * TenantContext onto the raw request as `req.tenantContext`; everything
 * downstream reads it through `TenantContextService` (never off headers).
 * See CLAUDE.md → Tenant context resolution.
 */
import { Inject, Injectable, Scope, createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import type { TenantContext } from "@pintle/contracts";

/** Property name the AuthGuard sets on the Fastify request. */
export const TENANT_CONTEXT_KEY = "tenantContext" as const;

interface RequestWithTenant {
  [TENANT_CONTEXT_KEY]?: TenantContext;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly req: RequestWithTenant) {}

  /** Resolved context, or undefined on public/unauthenticated routes. */
  get(): TenantContext | undefined {
    return this.req[TENANT_CONTEXT_KEY];
  }

  /** Resolved context or throw — use in tenant-scoped handlers. */
  require(): TenantContext {
    const ctx = this.get();
    if (!ctx) {
      throw new Error("TenantContext requested on a route with no resolved tenant");
    }
    return ctx;
  }

  get tenantId(): string {
    return this.require().tenantId;
  }
}

/** `@CurrentTenant()` — inject the resolved TenantContext into a handler. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return req[TENANT_CONTEXT_KEY];
  },
);
