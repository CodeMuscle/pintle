# CLAUDE.md — Pintle (Customer Migration Control Tower)

Project memory for Claude Code. Read this before working in this repo.

> ✅ **Reconciled against the canonical design docs (2026-05-17).** The tech
> stack, 14-module list, API envelope, and tenant-resolution mechanism below now
> match `/docs/design/` (`tech-stack.csv`, `lld.docx`, `database-blueprint.docx`)
> verbatim. The bootstrap `ASSUMPTIONS.md` has been resolved and removed; see
> `CHANGELOG.md`. If the docs change again, `/docs/design/` wins — update this
> file to match.

## What this is

An open-source **migration control tower** — the seam between Flatfile and
Rocketlane that B2B SaaS implementation teams have been missing. It runs
customer data migrations end-to-end: ingest source data, register schemas, map
and transform, validate, triage issues, execute the import, cut over, and keep
systems in sync afterward — all multi-tenant.

## Where the design lives

`/docs/design/` is the **single source of truth**. Read the full LLD,
database blueprint, and tech-stack matrix there before implementing a module.
If they conflict with this file, **the docs win** — then update this file.

## Tech stack

Verbatim from [`/docs/design/tech-stack.csv`](docs/design/tech-stack.csv) — the
authoritative matrix. Where it lists alternatives (e.g. "NestJS or Fastify"),
the choice is made per module against the LLD, not silently narrowed here.

| Layer              | Recommended stack                                                | Why                                                                                     |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Frontend apps      | Next.js, TypeScript, Tailwind, TanStack Query, Zustand or XState | Strong fit for dashboard + portal + workflow-heavy state.                               |
| SDKs               | TypeScript core SDK, React SDK, tsup, Storybook                  | Lets you ship embeddable import/progress widgets with shared contracts.                 |
| Backend app        | NestJS or Fastify + TypeScript                                   | Good balance of modular architecture, DX, queues, auth, and typed APIs.                 |
| Background jobs    | BullMQ + Redis initially                                         | Simpler than Kafka-first, enough for validation, import, retry, and sync jobs.          |
| Database           | PostgreSQL                                                       | Best fit for workflow state, auditability, versioned configs, and relational integrity. |
| File storage       | S3 / MinIO                                                       | Required for large uploads, raw source files, validation reports, and snapshots.        |
| Search / filtering | PostgreSQL JSONB first, optional OpenSearch later                | Good enough initially for issue search and logs.                                        |
| Realtime           | WebSockets or SSE                                                | Useful for long-running import progress and live status updates.                        |
| Auth               | Auth.js, Clerk, or custom JWT + RBAC                             | Use RBAC with tenant-aware roles from the beginning.                                    |
| Observability      | OpenTelemetry, Grafana, Loki, Tempo, Sentry                      | Strong architecture signal and useful for job tracing.                                  |
| Monorepo           | Turborepo + pnpm                                                 | Ideal for apps, SDKs, contracts, and shared UI.                                         |
| Infra              | Docker Compose locally; Render/Fly/AWS for deploy                | Keeps it practical while still professional.                                            |

Also fixed by the Module 1 brief and unchanged by the matrix: TypeScript 5.4+,
Node 20 LTS, Mailhog for local mail.

**Realized choices (Module 2).** Where the matrix left alternatives open, these
are now decided and in code:

- **ORM = Prisma 7** in `packages/db` (Postgres). The schema no longer
  carries `url`: CLI connection config lives in `packages/db/prisma.config.ts`
  (`datasource.url = env("DATABASE_URL")`); runtime `PrismaClient` uses the
  `@prisma/adapter-pg` driver adapter backed by a shared `pg` Pool (see
  `packages/db/src/index.ts`). `multiSchema` is GA — no preview flag —
  single `public` schema for v1. The base client is a lazy `Proxy` so
  `disconnectAll()` can fully tear down + rebuild between
  testcontainer-spec files. **Node ≥ 22.12 or ≥ 24** required (Prisma 7's
  preinstall blocks Node 23). Schema mirrors
  `database-blueprint.docx` Modules 1–6.
- **Runtime validation = Zod** in `packages/contracts` — the envelope, DTOs,
  enums, job/event envelopes are Zod schemas; TS types are `z.infer`red.
- **UI = Tailwind + shadcn/ui** in `packages/ui` (shared `tailwind-preset`,
  `cn()` helper, copy-in primitives). Apps consume the preset + `styles.css`.

**Realized choices (Module 3).** `services/api`:

- **Backend = NestJS 10 + Fastify** (`@nestjs/platform-fastify`). Built/run
  with the Nest CLI (`nest build` / `nest start --watch`); `pnpm --filter
@pintle/api dev` serves `:4000`.
- **Auth = Clerk** (`@clerk/backend`). The global `AuthGuard` is the
  implementation of "Tenant context resolution": Bearer → Clerk user → local
  `users` (by email) → `X-Tenant-Id` validated vs active `memberships`.
  `@Public()` opts out (e.g. `/health`); `@SkipTenantCheck()` allows
  authenticated-but-no-membership (accept-invitation).
- **Globals**: success interceptor (envelope), `AllExceptionsFilter` (error
  envelope + taxonomy), `ZodValidationPipe` (Zod DTOs from contracts — there
  are no class-validator classes), `nestjs-pino` (request_id + tenant_id +
  OTel trace_id on every line), OpenTelemetry auto-instrumentation (console
  exporter for now). Fastify owns `request.id` (honours inbound
  `x-request-id`) so logs and envelopes share one id.
- **tsconfig deviation (framework requirement, documented):**
  `services/api/tsconfig.json` turns off `verbatimModuleSyntax`/
  `isolatedModules`/`incremental` and turns on `emitDecoratorMetadata`/
  `experimentalDecorators` — NestJS DI needs runtime type metadata. It stays
  ESM (NodeNext, `.js` specifiers) so it can import the ESM-only
  `@pintle/contracts` and `/db` on Node 20. Package-local
  `.eslintrc.cjs` disables `consistent-type-imports` for the same reason.
- New env: `CLERK_SECRET_KEY` (required for authed routes), `LOG_LEVEL`,
  `OTEL_SERVICE_NAME` (see `.env.example`).

**Realized choices (Module 6).** `services/worker-validation` + the shared
`services/common`:

- **Worker = NestJS standalone** (no HTTP) on Fastify-less Nest. The BullMQ
  workers are attached in `OnApplicationBootstrap` and drained in
  `OnApplicationShutdown` (Nest fires those on SIGTERM/SIGINT once
  `enableShutdownHooks()` is called).
- **Shared queue layer** lives in `services/common`
  (`@pintle/services-common`): `createBaseWorker()` factory wraps
  every queue with the same patterns — 3-attempt exponential backoff, DLQ on
  terminal failure (`<queue>-dlq` sibling), idempotency short-circuit (Redis
  SETNX with 7-day TTL), and `ctx.progress(rows)` for chunked progress.
- **Queue payload types** are in `@pintle/contracts/queues.ts`
  (`UploadProcessingJobSchema`) so producer (API) and consumer (worker)
  share one source of truth.
- **Cross-process progress → SSE**: workers publish progress via
  `job.updateProgress` (BullMQ → Redis pub/sub). The API's `QueueEventsBridge`
  re-emits these as `source.batch.progress` / `source.batch.parsed` /
  `source.batch.failed` onto the in-process `EventBus`, and the SSE handler
  streams them to the client.
- New env for the worker: `REDIS_URL`, `S3_*` (same as the API), `OTEL_SERVICE_NAME=worker-validation`.

## Repository layout

```
apps/
  control-plane-web   internal operator console
  customer-portal     customer-facing migration portal
  docs-site           public docs
packages/
  contracts           canonical shared types (API envelope, tenant, jobs) — source of truth
  ui                  shared React design system
  sdk-core            framework-agnostic API client
  sdk-react           React bindings over sdk-core
  db                  database client, schema, migrations
  config/
    tsconfig          shared tsconfig bases
    eslint-config     shared ESLint config
    prettier-config   shared Prettier config
services/
  api                 HTTP API
  worker-validation   BullMQ worker — validation
  worker-import       BullMQ worker — import execution
  worker-sync         BullMQ worker — ongoing sync
infra/
  docker              local backing services (postgres, redis, minio, mailhog)
  terraform           IaC for deploy targets (Render/Fly/AWS) — placeholder
  monitoring          OpenTelemetry/Grafana/Loki/Tempo/Sentry config — placeholder
docs/design           design docs — READ FIRST
```

`infra/{docker,terraform,monitoring}` matches the LLD's recommended structure.

**Relationship to the LLD's recommended structure.** The LLD's repo sketch is
illustrative, not exhaustive — it collapses `config/*` to one entry and omits
`packages/db`. This repo intentionally extends it in two doc-justified ways:

- `packages/db` — required by `database-blueprint.docx` (single Postgres DB,
  versioned schema/migrations, repository-layer tenant scoping). Not optional.
- `apps/docs-site` — public docs site; **not** in the LLD. Kept as an additive
  app (it conflicts with nothing). Remove it if a public docs surface is out of
  scope; nothing else depends on it.

npm scope: `@pintle/*`. The product/brand is **Pintle** (the customer
migration control tower); all packages were rebranded from the former
`@migrationtower/*` scope on 2026-07-28 — the scope, infra identifiers
(Postgres/MinIO creds, OTel service names), local folder, and GitHub remote
(`CodeMuscle/pintle`) are now uniform. Module briefs sometimes use a
placeholder `@app/*` (e.g. `pnpm --filter @app/db …`); that is **not** this
repo's scope — always use `@pintle/*`.

## Modules (14)

The 14 bounded modules below, **in the order the LLD presents them**
([`lld.docx`](docs/design/lld.docx) → "Module boundaries"). These are domain
modules inside the modular monolith; **SDK is not a module** — it is the
`sdk-core` / `sdk-react` packages (embeddable widgets + typed client) and is
sequenced in the implementation order, not numbered here.

> Reconciliation note: the LLD corrected three bootstrap guesses — Sync is
> module **10** and Cutover is **11** (the bootstrap had them swapped and listed
> SDK as a module); the cross-cutting modules are **Notification (12)**,
> **Analytics (13)**, and **Audit (14)** as three distinct modules, not the
> inferred "Notifications & Webhooks" + "Audit, Observability & Reporting" pair.

1. **Identity** — users, authentication, sessions, invitations, role grants; produces the normalized auth context for downstream modules
2. **Tenant** — organizations, plans, feature entitlements, environment settings, tenant-level limits
3. **Migration project** — project lifecycle: creation, status, stage progression, owners, deadlines, environment selection, success criteria
4. **Source ingestion** — uploads/source connections, raw artifacts to object storage, batch records, dispatch parsing jobs
5. **Schema registry** — source schema snapshots + destination schema definitions, custom-field metadata, version history
6. **Mapping** — source→destination field mappings, transform rules, templates, defaults, immutable version diffs
7. **Validation** — async rule engine over source data + mappings; powered by `worker-validation`
8. **Issue management** — validation output → actionable issues with owners, status, comments, resolution states
9. **Import execution** — dry-run and production imports; chunked, idempotent; powered by `worker-import`
10. **Sync** — late-stage incremental imports after first load and before cutover (scheduling, conflict detection); powered by `worker-sync` _(built last — see order below)_
11. **Cutover** — approvals, readiness checks, final import, freeze windows, rollback metadata
12. **Notification** — event-driven emails, in-app alerts, and webhooks for status changes, blockers, approvals, job completion
13. **Analytics** — project throughput, issue density, time-to-live, validation-failure distribution, team bottlenecks (tenant-dimensioned)
14. **Audit** — immutable records of sensitive actions: mapping edits, approvals, imports, retries, data access

### Suggested implementation order

Per the LLD's "Best implementation order" — build a usable vertical slice early.
Note Sync is module 10 but is built **last**.

1. Tenant/auth + project module
2. File upload + source batch records
3. Validation worker + issue persistence
4. Mapping UI + mapping versions
5. Dry-run import worker + reconciliation
6. Customer portal progress and blocker views
7. Cutover + approvals
8. SDK widgets
9. Analytics + observability
10. Incremental sync _(last)_

## Coding conventions (non-negotiable)

1. **Tenancy.** Every persisted business record carries a `tenant_id` column.
   No cross-tenant query is allowed. Enforcement point: `prismaForTenant(id)`
   from `@pintle/db` — it auto-injects `tenant_id` into every
   where/create and **overrides** any caller-supplied `tenantId` (a caller
   cannot escape its tenant). Domain/repository code uses the scoped client and
   never hand-writes tenant filters; the base `prisma` client is for
   global/identity reads, migrations, and seed only. Use `TenantScoped` /
   `TenantContext` from `@pintle/contracts` for typing.
2. **API envelope.** Every HTTP endpoint returns the canonical envelope from
   [`database-blueprint.docx`](docs/design/database-blueprint.docx) — never a
   bare resource. Implemented as `ApiEnvelope<T>` in
   `packages/contracts/src/envelope.ts`. Success is `{ data, meta }`; error is
   `{ error: { code, message, details[] }, meta }`; `meta` is always
   `{ requestId, timestamp }`. Success responses carry **no** `error` key and
   error responses carry **no** `data` key. Use the `ok()` / `fail()` helpers
   and the `ApiErrorCode` taxonomy union.
3. **Tenant middleware.** Every protected endpoint resolves tenant context via
   middleware before handler logic — handlers never parse tenancy themselves.
   See "Tenant context resolution" below for the exact header contract.
4. **Idempotent jobs.** Every async unit of work is a BullMQ job using
   `JobEnvelope<T>` with an `idempotencyKey`. Re-enqueuing the same key must not
   double-process.

## Tenant context resolution

Per the LLD ("Identity module": every authenticated request resolves both
`userId` and `tenantId`; tenant context is required in downstream services) and
the blueprint's "Auth context", every protected request carries:

| Header            | Value            | Required                                                                      |
| ----------------- | ---------------- | ----------------------------------------------------------------------------- |
| `Authorization`   | `Bearer <token>` | Always (protected routes)                                                     |
| `X-Tenant-Id`     | `<tenant_uuid>`  | Always (protected routes)                                                     |
| `Idempotency-Key` | `<uuid>`         | Mutating workflows: upload-complete, mapping version publish, import creation |

Resolution mechanism (shared Postgres, app-level scoping — **not** RLS):

1. The auth guard validates the bearer token and loads the principal.
2. It validates `X-Tenant-Id` against the principal's **memberships**
   (`memberships.tenant_id` for that `user_id`, status `active`).
3. On success it builds `TenantContext` (`{ tenantId, userId, roles }`) before
   any handler runs. Handlers and repositories receive tenant context; no
   handler parses headers itself.
4. Rejections use the error taxonomy:
   - missing/invalid token or missing `X-Tenant-Id` → `AUTH_REQUIRED`
   - valid token but `X-Tenant-Id` not among the user's active memberships →
     `TENANT_FORBIDDEN`

Every persisted business row carries `tenant_id`; every query path enforces
tenant scoping at the repository layer; every log/metric/trace includes the
tenant dimension. The `Identity` module (built first) owns the auth guard;
until it lands, this contract is the spec it must satisfy.

## Naming patterns

| Thing                        | Convention           | Example                             |
| ---------------------------- | -------------------- | ----------------------------------- |
| Files / dirs                 | kebab-case           | `source-ingestion.service.ts`       |
| Types / classes / interfaces | PascalCase           | `MigrationProject`, `ApiEnvelope`   |
| DB columns                   | snake_case           | `tenant_id`, `created_at`           |
| API JSON payload fields      | camelCase            | `tenantId`, `createdAt`             |
| Env vars                     | SCREAMING_SNAKE      | `DATABASE_URL`                      |
| Commits                      | Conventional Commits | `feat(validation): add rule engine` |

DB is snake_case, the wire is camelCase — map at the serialization boundary, not
ad hoc.

## Common commands

```bash
pnpm install                 # install workspace
pnpm build                   # turbo build all packages
pnpm dev                     # turbo dev (watch)
pnpm lint                    # eslint across workspace
pnpm type-check              # tsc --noEmit across workspace
pnpm test                    # tests across workspace
pnpm format                  # prettier write
pnpm docker:up / docker:down # local postgres/redis/minio/mailhog
```

## Conventions for working in this repo

- Shared types go in `@pintle/contracts` and are imported, never
  re-declared per package.
- Extend the shared `@pintle/tsconfig` / `eslint-config` /
  `prettier-config`; don't fork tool config per package.
- Commits must pass commitlint (Conventional Commits); hooks run lint-staged.
- New backing service → add to `infra/docker/docker-compose.yml` **and**
  `.env.example`.
- Don't weaken a shared config to make one package pass — fix the package.
