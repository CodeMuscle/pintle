/**
 * Global AuthGuard. Enforces the blueprint's auth contract on every route
 * that is not @Public():
 *   1. `Authorization: Bearer <token>` → verified via Clerk
 *   2. Clerk user → local `users` row (by primary email)
 *   3. `X-Tenant-Id` header → validated against the user's active memberships
 *   4. resolved TenantContext attached to the request
 * Rejections use the canonical taxonomy: missing/invalid auth or unprovisioned
 * user → AUTH_REQUIRED; valid user but no membership → TENANT_FORBIDDEN.
 * (CLAUDE.md → Tenant context resolution.)
 */
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantContext } from "@pintle/contracts";
import { prisma } from "@pintle/db";

import { ApiException } from "../common/api-exception.js";
import { IS_PUBLIC_KEY, SKIP_TENANT_CHECK_KEY } from "../common/decorators.js";
import { TENANT_CONTEXT_KEY } from "../common/tenant-context.js";

import { ClerkService } from "./clerk.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clerk: ClerkService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers?.authorization;

    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
    if (!token) {
      throw ApiException.authRequired("Missing Bearer token");
    }

    const clerkUserId = await this.clerk.verifyUserId(token);
    if (!clerkUserId) {
      throw ApiException.authRequired("Invalid or expired token");
    }

    const email = await this.clerk.primaryEmail(clerkUserId);
    if (!email) {
      throw ApiException.authRequired("Could not resolve Clerk user email");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw ApiException.authRequired("User is not provisioned in this system");
    }

    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_CHECK_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const tenantId: string | undefined = req.headers?.["x-tenant-id"];
    let roles: string[] = [];

    if (skipTenant) {
      // e.g. accept-invitation: the tenant comes from the invite token, so an
      // X-Tenant-Id header is optional and membership does not exist yet.
    } else {
      if (!tenantId) {
        throw ApiException.authRequired("Missing X-Tenant-Id header");
      }
      const membership = await prisma.membership.findFirst({
        where: { tenantId, userId: user.id, status: "active" },
      });
      if (!membership) {
        throw ApiException.tenantForbidden("No active membership for this tenant");
      }
      roles = [membership.role];
    }

    const context: TenantContext = {
      tenantId: tenantId ?? "",
      userId: user.id,
      roles,
    };
    (req as Record<string, unknown>)[TENANT_CONTEXT_KEY] = context;
    return true;
  }
}
