/**
 * @pintle/db — Prisma client + tenant-scoped access.
 *
 * Two entry points:
 *   - `prisma`               base client; use for global/identity reads
 *                            (users) and migrations/seed only.
 *   - `prismaForTenant(id)`  tenant-bound client that auto-injects
 *                            `tenant_id` into every where/create for
 *                            tenant-owned models. This is the enforcement
 *                            point CLAUDE.md → Coding conventions §1 requires:
 *                            domain code must never hand-write tenant filters.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
// Prisma 7 moved the runtime error classes out of the `Prisma` namespace.
// Re-export here so consumers stay on a single import surface.
export { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

// Prisma 7: the schema no longer has `url`; the runtime client talks to the
// DB through a driver adapter (here @prisma/adapter-pg backed by a shared
// `pg` Pool). The client + pool are LAZILY built so `disconnectAll()` can
// fully tear them down and the next access rebuilds — required by the
// per-file Postgres testcontainer pattern (each spec stops its container in
// afterAll and the next spec spins a fresh one in the same vitest process).
const globalForPrisma = globalThis as unknown as {
  __mt_pool__?: Pool;
  __mt_client__?: PrismaClient;
};

function getPool(): Pool {
  if (!globalForPrisma.__mt_pool__) {
    globalForPrisma.__mt_pool__ = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return globalForPrisma.__mt_pool__;
}

function getClient(): PrismaClient {
  if (!globalForPrisma.__mt_client__) {
    globalForPrisma.__mt_client__ = new PrismaClient({
      adapter: new PrismaPg(getPool()),
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return globalForPrisma.__mt_client__;
}

/**
 * Base client. Backed by a Proxy so it survives `disconnectAll()`/rebuild
 * cycles — every property access lazily resolves the current underlying
 * client. Not tenant-scoped.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const v = client[prop as string | symbol];
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(client) : v;
  },
}) as PrismaClient;

/**
 * Symmetric shutdown for the v7 adapter pattern: `$disconnect()` releases
 * Prisma's adapter resources but does NOT close the underlying `pg` Pool,
 * so it must be ended explicitly (otherwise tests/test-containers see
 * "terminating connection due to administrator command" on teardown). The
 * client + pool slots are cleared so a subsequent access rebuilds against
 * whatever `DATABASE_URL` is current — important between testcontainer
 * spec files.
 */
export async function disconnectAll(): Promise<void> {
  const client = globalForPrisma.__mt_client__;
  if (client) {
    await client.$disconnect();
    globalForPrisma.__mt_client__ = undefined;
  }
  const pool = globalForPrisma.__mt_pool__;
  if (pool) {
    await pool.end();
    globalForPrisma.__mt_pool__ = undefined;
  }
}

/**
 * Models that carry `tenant_id` and are filtered by `prismaForTenant`.
 * `User` is intentionally absent — user identities are global; resolve a
 * user's tenants through `Membership`. `Tenant` is scoped by its own `id`.
 *
 * `DestinationSchema` / `MappingTemplate` have a nullable `tenant_id` (global
 * catalog rows): the scoped client only sees the tenant's own rows — read
 * globals via the base `prisma` client.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  "Tenant",
  "Membership",
  "Invitation",
  "TenantSettings",
  "FeatureEntitlement",
  "MigrationProject",
  "MigrationStageHistory",
  "ProjectMember",
  "ProjectActivity",
  "DataSource",
  "SourceUpload",
  "SourceBatch",
  "DestinationSchema",
  "SourceSchemaSnapshot",
  "SchemaField",
  "FieldMapping",
  "TransformRule",
  "MappingVersion",
  "MappingTemplate",
]);

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

type AnyArgs = Record<string, unknown>;

function scopeWhere(args: AnyArgs, scope: AnyArgs): AnyArgs {
  const where = (args.where as AnyArgs | undefined) ?? {};
  return { ...args, where: { ...where, ...scope } };
}

function injectData(args: AnyArgs, scope: AnyArgs): AnyArgs {
  const data = args.data;
  if (Array.isArray(data)) {
    return {
      ...args,
      data: data.map((row) => ({ ...scope, ...(row as AnyArgs) })),
    };
  }
  return { ...args, data: { ...scope, ...((data as AnyArgs) ?? {}) } };
}

/**
 * Tenant-bound Prisma client. Every query against a tenant-scoped model is
 * constrained to `tenantId`; creates have `tenantId` injected. Re-using one
 * instance per tenant per request is fine — it wraps the shared connection
 * pool of the base client.
 */
export function prismaForTenant(tenantId: string) {
  if (!tenantId) {
    throw new Error("prismaForTenant: tenantId is required");
  }

  // Prisma 7 quirk: when `prisma` is a Proxy (typed `as PrismaClient`), the
  // generic plumbing on `$extends({ query: { $allModels: { $allOperations } } })`
  // produces a return type where every model accessor narrows to `never`. The
  // runtime extension still works fine — it's a type-inference regression
  // from the v6→v7 upgrade combined with our lazy-Proxy base. We assert the
  // result back to `PrismaClient` so consumers keep the full model surface
  // (`scoped.migrationProject.findUnique(...)`, etc.), at the cost of losing
  // the "this client is extended" tag at the type level — which we don't
  // depend on anywhere.
  const extended = prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: unknown;
          query: (a: unknown) => Promise<unknown>;
        }) {
          if (model === "User" || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // The Tenant row itself is identified by its own primary key.
          const scope: AnyArgs = model === "Tenant" ? { id: tenantId } : { tenantId };

          let next: AnyArgs = (args as AnyArgs) ?? {};

          if (WHERE_OPS.has(operation)) {
            next = scopeWhere(next, scope);
          } else if (operation === "create" || operation === "createMany") {
            next = injectData(next, scope);
          } else if (operation === "upsert") {
            next = scopeWhere(next, scope);
            const create = (next.create as AnyArgs | undefined) ?? {};
            next = { ...next, create: { ...scope, ...create } };
          }

          return query(next);
        },
      },
    },
  });
  return extended as unknown as PrismaClient;
}

/** The tenant-scoped client type, for typing repositories/services. */
export type TenantPrismaClient = PrismaClient;
