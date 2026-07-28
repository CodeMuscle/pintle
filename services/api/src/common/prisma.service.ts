/**
 * PrismaService — the only way handlers touch the database.
 *
 *   .tenant  request-scoped client from prismaForTenant(); auto-injects and
 *            overrides tenant_id on every query (CLAUDE.md → Coding
 *            conventions §1). Use for all tenant-owned data.
 *   .base    unscoped client; identity/global reads only (resolve a user by
 *            email before a tenant is known, migrations, seed).
 */
import { Injectable, Scope } from "@nestjs/common";
import { prisma, prismaForTenant } from "@pintle/db";
import type { TenantPrismaClient } from "@pintle/db";

import { TenantContextService } from "./tenant-context.js";

@Injectable({ scope: Scope.REQUEST })
export class PrismaService {
  private scoped?: TenantPrismaClient;

  constructor(private readonly tenantCtx: TenantContextService) {}

  /** Unscoped client — global/identity reads only. */
  get base() {
    return prisma;
  }

  /** Tenant-scoped client. Throws if the route has no resolved tenant. */
  get tenant(): TenantPrismaClient {
    this.scoped ??= prismaForTenant(this.tenantCtx.tenantId);
    return this.scoped;
  }
}
