# Changelog

## [Unreleased]

- chore(db): upgrade Prisma 6.19 → 7.8 (driver-adapter pattern)
  - `url` removed from `schema.prisma`. CLI connection config lives in
    `packages/db/prisma.config.ts` (`datasource.url = env("DATABASE_URL")`,
    seed config also moved here per v7); runtime `PrismaClient` is
    constructed with `@prisma/adapter-pg` backed by a shared `pg.Pool` in
    `src/index.ts`. New deps: `@prisma/adapter-pg`, `pg`, `dotenv`,
    `@types/pg`.
  - Base `prisma` is now a lazy `Proxy` so `disconnectAll()` can fully
    teardown + rebuild between testcontainer spec files (otherwise the
    second file in the same vitest process tries to reuse a closed Pool
    and fails with "Cannot use a pool after calling end on the pool").
  - New `disconnectAll()` export — `$disconnect()` doesn't close the
    adapter's underlying `pg.Pool` on its own; tests now call this in
    `afterAll` to avoid "terminating connection due to administrator
    command" errors when testcontainers stop.
  - **Node requirement** bumped: Prisma 7 hard-blocks Node 23 in its
    preinstall; project Node target is now **22.12+ or 24+** (we use
    `nvm use 22` locally). Recorded in `CLAUDE.md`.
  - Silences both the VS Code Prisma extension's v7 advisories
    (`multiSchema preview deprecated`, `url no longer supported`). All
    integration tests still green (API 4/4, worker 2/2).

- feat(api,worker,contracts,db): Validation + Issue Management (LLD §7–§8)
  - **Schema** (new migration `add_validation`): `validation_runs` (run
    lifecycle + denormalised per-severity counts) and `validation_issues`
    (append-only finding rows; grouped at query time by
    `destination_field_key + rule_key`, no separate `issue_groups` table per
    the brief). Both tenant-scoped with the standard FK + indexes — including
    `(tenantId, projectId, status, createdAt desc)` for the project issues
    feed and `(tenantId, runId, severity)` for `getRun` counts.
  - **Contracts**: `ValidationDTO` (run create/get/summary, issue list,
    PATCH + bulk-resolve), enums (`IssueSeverity`, `IssueStatus`,
    `ValidationRunStatus`, `ValidationRuleKey`), and the `ValidationJob` /
    `ValidationResult` queue schemas (blueprint Module 6 "validation-ready
    handoff contract" + server-issued `runId`). New `DOMAIN_EVENTS`:
    `validation.started/progress/completed/failed`, `issues.generated`,
    `issue.resolved`, `issue.ignored`.
  - **API**:
    - `POST /v1/migration-projects/:projectId/validate` — validates batch +
      mapping version belong to the project, creates `validation_runs`
      `status='queued'`, enqueues the `validation` BullMQ job (jobId =
      `validation-<runId>` for dedupe + bridge routing). Returns `{ runId }`.
    - `GET /v1/validation-runs/:runId` — status + denormalised counts +
      timings.
    - `GET /v1/validation-runs/:runId/summary` — issues grouped by
      `(destinationFieldKey, ruleKey, severity)` with 5 sample issues per
      group.
    - `GET /v1/validation-runs/:runId/events` — **SSE** stream: emits a
      snapshot of the run on connect, then streams
      `validation.started/progress/completed/failed` + `issues.generated`
      bridged from the worker via BullMQ QueueEvents.
    - `GET /v1/migration-projects/:projectId/issues` — keyset cursor
      paginated; filters: `status`, `severity`, `destinationFieldKey`,
      `runId`.
    - `PATCH /v1/issues/:id` — resolve / ignore + note. Emits
      `issue.resolved` / `issue.ignored`.
    - `POST /v1/issues/bulk-resolve` — filter (projectId required) →
      `updateMany`; returns count. Same events.
  - **Worker** (`services/worker-validation`): real `ValidationProcessor`
    replaces the stub. Loads the mapping version + destination schema +
    upload, streams the S3 object → temp file → `csv-parse`. The pure-
    function rule engine (`rule-engine.ts`) implements all v1 rules:
    `required`, `type_mismatch`, `regex`, `enum`, `date_format`
    (pattern + `Date.parse` so `2024-13-99` doesn't slip through),
    `uniqueness` (intra-batch), `foreign_key_exists` (intra-batch, two-pass
    so the target set is complete). Issues flush to DB every 1 000 rows
    along with a `job.updateProgress`. Run is finalised with status +
    counts + timings. Determinate failures throw `UnrecoverableError`
    (DLQ on first attempt) and record `status='failed'` + `errorMessage`
    on the run row.
  - **QueueEventsBridge**: extended to also subscribe to the `validation`
    queue and re-emit `progress` / `completed` (+ `issues.generated`
    derived from the returnvalue counts) / `failed` onto the EventBus.
  - **Integration test** (worker): a 10 000-row CSV with five deliberately
    broken column classes (`required` via 100 empty emails, `uniqueness`
    via 50 duplicate ids, `enum` via 30 bad tiers, `date_format` via 20
    `2024-13-99`s, `regex` via 40 `USA`s vs `^[A-Z]{2}$`). Asserts the
    exact per-rule counts on the strict run, then runs again against a
    second mapping version with `isRequiredOverride=false` on `email` and
    asserts the "required" group vanishes (100 → 0) while the others
    stay put. Existing 1 worker test + 4 API tests still pass. **3 / 3
    test files passing.**

- feat(api,contracts): Schema Registry + Mapping (blueprint Modules 5 & 6)
  - **Schema Registry**:
    - `GET /v1/projects/:projectId/source-schema` — latest non-failed source
      snapshot (skips the `version=-1` sentinel the parse worker writes on
      failure).
    - `GET /v1/destination-schemas/:productType/active` — tenant-scoped row
      wins over the global fallback (uses the base prisma so global
      `tenantId IS NULL` rows are visible).
    - `POST /v1/projects/:projectId/source-schema/refresh` — creates a
      `retry` batch for the latest upload and enqueues the
      `upload-processing` job. Idempotent: re-calls collapse onto an
      existing in-flight retry batch (BullMQ also dedupes by jobId).
  - **Mapping**:
    - `GET /v1/projects/:projectId/mappings` — drafts + unresolved
      destination fields (set diff against the destination schema) +
      template suggestions (filtered by `targetProductType`, and by
      `sourceSystemName` when the project has a `data_sources` row with an
      `external_system_name`) + the available transform rules.
    - `PUT /v1/projects/:projectId/mappings` — bulk upsert. Validates that
      `sourceSnapshotId` belongs to the project and the
      `destinationSchemaId` is active for this tenant. Each `transform`
      mapping must reference a known `transformRuleId`. The replacement
      is a `deleteMany` → `createMany` in one transaction, scoped to the
      `(project, snapshot, dest)` tuple.
    - `POST /v1/projects/:projectId/mappings/publish` — `If-Match` header
      carries the current draft fingerprint (max draft `updatedAt`); a
      mismatch returns `CONFLICT` (stale draft). The transaction takes a
      `SELECT … FOR UPDATE` lock on the project row before reading
      `MAX(versionNumber)`, so two concurrent publishes can't pick the
      same monotonic version.
    - `GET /v1/projects/:projectId/mappings/versions` — keyset (cursor)
      paginated.
    - `GET /v1/projects/:projectId/mappings/diff?from=&to=` — added /
      changed / removed by `destinationFieldKey`, with the full `from`
      and `to` mapping rows on each entry.
  - **Built-in transform rules** (per-tenant, lazy-upserted on first GET
    or PUT): `trim`, `uppercase`, `lowercase`, `concat`, `date_parse`,
    `phone_normalize`. Per-rule config schemas live in
    `@pintle/contracts` (`MappingDTO.TransformRuleConfigSchemas`)
    so the SDK + UI can validate before the API does.
  - Domain events: `mapping.draft.updated`, `mapping.version.published`,
    `schema.source_snapshot.refreshed`. (`mapping.template.applied` is
    in `DOMAIN_EVENTS` for when a templating endpoint lands.)
  - Per-endpoint Pino structured logging
    (`tenant_id`/`user_id`/`project_id`/`mappingVersionId`).
  - **Integration test**: publish v1 (direct mappings) → edit drafts
    (remove one, change one to `transform: uppercase`, add one) →
    publish v2 → `diff(from=1, to=2)` returns the expected added /
    changed / removed sets. Existing 3 tests still pass. Worker test
    still passes. 4 API tests + 1 worker test, all green.
  - **Skipped (per brief's "optional")**: the `schema_fields` helper
    table. Inferred columns live in `source_schema_snapshots.schema_json`
    which is queryable enough for the frontend; the helper table can be
    added later behind an async populator job without breaking callers.

- feat(worker,api,contracts): Module 6 — BullMQ worker layer + upload parse
  - **`services/common`** (`@pintle/services-common`): shared
    `createBaseWorker()` factory implementing the patterns the brief calls
    out — 3-attempt exponential backoff, terminal-failure DLQ
    (`<queue>-dlq`), Redis-SETNX idempotency short-circuit (7-day TTL), and
    `ctx.progress(rows)` for chunked progress. `redisConnection()` helper
    derives a BullMQ `ConnectionOptions` from `REDIS_URL`.
  - **`services/worker-validation`** rewritten from placeholder to a real
    **NestJS standalone** app (no HTTP). `OnApplicationBootstrap` attaches
    BullMQ Workers for `upload-processing` and `validation` (stub); SIGTERM
    drains them via `OnApplicationShutdown`. Same Pino + OpenTelemetry
    plumbing as the API.
  - **upload-processing processor** (the parse half of LLD §7): S3 stream →
    temp file → format detect (csv/xlsx/json, ext + content sniff) → stream
    CSV via `csv-parse` (sample first 100 rows; count + emit progress every
    1000 rows for the rest) → per-column type inference
    (boolean → date → number → enum-if-cardinality≤20 → string) →
    `source_schema_snapshots` row written with `version = max+1` per project
    (inside a transaction so concurrent batches don't collide) → batch
    `row_count` + `finished_at` + `status='parsed'`. Determinate failures
    throw `UnrecoverableError` so they don't burn retries; transient
    failures use the default backoff.
  - **Contracts**: `UploadProcessingJobSchema` + `UploadProcessingResult`
    pulled into `@pintle/contracts/queues.ts` as the single source
    of truth for producer (API) and consumer (worker). Added
    `source.batch.progress` to `DOMAIN_EVENTS`.
  - **API → SSE bridge**: new `QueueEventsBridge` (singleton, OnAppBootstrap)
    subscribes to BullMQ `QueueEvents` for `upload-processing` and lifts
    `progress` / `completed` / `failed` onto the in-process `EventBus` keyed
    by `batchId` (extracted from `jobId = upload-processing-<batchId>`). The
    SSE handler now streams `source.batch.progress` alongside
    `created/parsed/failed`. API's `UploadQueue` refactored to use the
    shared types + `DEFAULT_JOB_OPTIONS` from services-common.
  - **Tests**: new Vitest integration test against real Postgres
    (testcontainers) + mocked S3 (`aws-sdk-client-mock`). A 5000-row CSV
    runs through the processor; asserts row_count=5000, snapshot v1 created,
    per-column types are `id:number / email:string / active:boolean /
joined_at:date / tier:enum[bronze,gold,silver]`, batch transitions to
    `parsed`, and progress ticks fire every 1000 rows. Passes. Existing API
    tests still 3/3.

- chore(db): upgrade Prisma 5.22 → 6.19
  - Silences the VS Code Prisma extension's "`multiSchema` preview deprecated"
    advisory — multiSchema is GA in Prisma 6.7+, so the `previewFeatures`
    entry is gone. `schemas = ["public"]` and `@@schema("public")` continue
    to work without any flag.
  - **Prisma 7 deferred:** v7's preinstall hard-blocks Node 23 (allows only
    20.19+, 22.12+, 24+). The "`url` no longer supported" IDE warning is a
    v7-only language-server advisory — it doesn't affect the v6 CLI/runtime.
    Address when the project's Node version targets a v7-allowed line.
  - Migrations chain unchanged; integration tests still 3/3; `seed` runs
    clean against the dev DB.

- feat(api,db): Source Ingestion (blueprint Module 4)
  - **S3/MinIO** (`@aws-sdk/client-s3` + presigner): 15-min presigned PUT,
    HEAD verification, key pattern
    `tenants/{tenant_id}/projects/{project_id}/uploads/{upload_id}/{filename}`.
  - Upload lifecycle: `POST /v1/projects/:projectId/uploads/presign`
    (per-tenant size quota from `feature_entitlements`, pending
    `source_uploads` row, presigned URL), `…/uploads/complete` (HEAD verify →
    `source_uploads`=uploaded → `source_batches`=queued → enqueue
    `upload-processing` BullMQ job with the **exact** blueprint payload
    `{tenantId,projectId,batchId,uploadId,objectKey,sourceType}`),
    `GET /v1/projects/:projectId/sources` (data sources + latest batch
    status), `GET /v1/source-batches/:batchId`.
  - **Idempotency-Key** on presign: `idempotency_keys` table (new Prisma
    model + migration), `(tenant_id, idempotency_key)` → response, 24h TTL,
    cached replay.
  - **SSE** `GET /v1/source-batches/:batchId/events`: emits a `snapshot`
    frame (current status — so the queued state is visible even if you
    connect after `complete`) then streams `source.batch.*` events for that
    batch via the EventBus stub. Bypasses the success-envelope interceptor
    (`@SkipEnvelope()`).
  - Emits `source.upload.registered`, `source.upload.completed`,
    `source.batch.created`.
  - Verified end-to-end against **real MinIO + Redis + Postgres**: presign →
    real HTTP PUT to MinIO → idempotent replay → complete → batch=queued →
    BullMQ job present with exact contract payload → SSE snapshot=queued.
    Existing integration tests still 3/3 (migration chain applies cleanly).

- feat(api): Tenant + Migration Projects modules (blueprint Modules 2 & 3)
  - **Tenant**: `GET /v1/tenant`, `PATCH /v1/tenant/settings`,
    `GET /v1/tenant/features` (process-wide 1-min TTL cache, singleton
    `FeatureCache`). Emits `tenant.settings.updated` and
    `tenant.feature.updated` via the EventBus stub.
  - **Migration Projects**: `POST /v1/migration-projects` (per-tenant
    `project_code` uniqueness → `CONFLICT`); `GET /v1/migration-projects`
    (filters status/stage/ownerUserId/search, **keyset/cursor** pagination,
    not offset); `GET /v1/migration-projects/:id` (project + last 10 activity - summary: `lastBatchStatus`, `openIssuesCount` placeholder until Module
    8); `POST /:id/advance-stage` (server-enforced state machine); `GET
/:id/activity` (cursor paginated). Emits `migration_project.created`,
    `.stage_changed`, `.blocked`, `.completed`.
  - **Stage machine** (`stage-machine.ts`, pure/unit-testable): setup →
    ingestion → mapping → validation → dry_run → cutover → complete, with a
    `blocked` status side-branch from any stage and resume; illegal moves →
    `CONFLICT`. `advance-stage` writes `migration_stage_history` + a
    `project_activity` row in one transaction.
  - **Project members**: `POST /:id/members`, `DELETE /:id/members/:memberId`
    (tenant-internal RBAC; customer-portal magic-link auth is later).
  - Per-endpoint Pino structured logging (`tenant_id`, `user_id`,
    `project_id`).
  - Contracts extended (cursor list/detail/summary/activity/members/
    advance-stage incl. `blocked`).
  - Integration tests: Vitest + testcontainers Postgres against the committed
    migrations — tenant-scoping isolation (cross-tenant read → 404), stage
    transition rejection, per-tenant `project_code` uniqueness. 3/3 pass.

- feat(api): Module 3 — NestJS 10 API service (`services/api`)
  - NestJS 10 on Fastify (`@nestjs/platform-fastify`), ESM, built/run via the
    Nest CLI; serves `:4000`.
  - Global concerns: success-envelope interceptor; `AllExceptionsFilter`
    (canonical error envelope + ApiErrorCode taxonomy, incl. ZodError →
    VALIDATION_FAILED); `ZodValidationPipe` (validates contracts' Zod DTOs —
    no class-validator); `nestjs-pino` with `request_id`/`tenant_id` (+ OTel
    `trace_id`) on every line; OpenTelemetry auto-instrumentation (HTTP/PG/
    Redis, console exporter). Fastify owns `request.id` (honours
    `x-request-id`) so logs and envelopes correlate.
  - Auth: Clerk (`@clerk/backend`) global `AuthGuard` — Bearer → Clerk user →
    local `users` (by email) → `X-Tenant-Id` vs active `memberships`;
    `@Public()` / `@SkipTenantCheck()` opt-outs. Rejections use
    AUTH_REQUIRED / TENANT_FORBIDDEN.
  - `common` module (the brief's `@app/api/common`): request-scoped
    `TenantContextService`, `PrismaService` wrapping `prismaForTenant`,
    in-memory `EventBus` stub.
  - Identity module (blueprint Module 1): `POST /v1/auth/invitations`,
    `POST /v1/auth/invitations/accept`, `GET /v1/me`. Plus `GET /health`
    (public) and `GET /v1/_introspect` (echoes resolved TenantContext).
  - tsconfig/eslint per-package deviations for NestJS DI documented in
    CLAUDE.md. New env: `CLERK_SECRET_KEY`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`.
  - Verified end-to-end: server boots `:4000`; `/health` → success envelope;
    unauthed `/v1/me` → 401 AUTH_REQUIRED envelope; invalid token →
    AUTH_REQUIRED; **and** a real Clerk JWT + `X-Tenant-Id` → `/v1/me`
    returns the seeded user + tenant + roles in the success envelope.
  - Seed: `SEED_DEMO_EMAIL` overrides the demo operator email (so it can be
    matched to a Clerk user's primary email); seed log now prints tenant/user
    ids.

- feat(db,contracts,ui): Module 2 — database layer + shared contracts
  - **packages/db**: Prisma (`multiSchema`, single `public` schema; preview
    flag dropped on the v6 upgrade — see above).
    Models for all 20 tables of blueprint Modules 1–6 (Identity, Tenant,
    Migration Projects, Source Ingestion, Schema Registry, Mapping) — UUID PKs
    (`@db.Uuid`), CITEXT emails, TIMESTAMPTZ, JSONB, every unique/index from
    the blueprint. Initial migration adds `CREATE EXTENSION citext/pgcrypto`,
    CHECK constraints for all enum-like columns, and the 3 partial indexes.
    `prismaForTenant(tenantId)` auto-injects/overrides `tenant_id` on every
    query (tenancy enforcement point); base `prisma` for global/seed only.
    Idempotent seed: demo tenant + user + owner membership + settings + global
    CRM destination schema. Verified: `migrate dev` creates all tables, `seed`
    populates, scoped client blocks cross-tenant reads.
  - **packages/contracts**: Zod schemas + `z.infer` types for the canonical
    envelope (success/error), shared enums, Modules 1–6 request/response DTOs,
    job envelope + validation handoff, and all blueprint domain events. Builds
    to consumable `.d.ts`.
  - **packages/ui**: Tailwind + shadcn/ui baseline — shared `tailwind-preset`,
    `cn()`, `Button` (cva), token `globals.css`, `components.json`.
  - CLAUDE.md: recorded realized stack choices (Prisma/Zod/Tailwind+shadcn),
    the `prismaForTenant` tenancy rule, and the `@app/*` vs `@pintle/*`
    scope caveat.

- chore: reconcile bootstrap against canonical design docs

  The Module 1 bootstrap was inferred without `/docs/design/` present. With
  `tech-stack.csv`, `lld.docx`, and `database-blueprint.docx` now in place,
  the inferred decisions were reconciled to match the docs verbatim:
  - **Tech stack** (`CLAUDE.md`): replaced the inferred table with the
    `tech-stack.csv` matrix (Layer / Recommended stack / Why). Dropped the
    inferred "Fastify + Prisma + Zod + Vitest defaults" framing — the CSV
    lists alternatives (e.g. NestJS or Fastify) chosen per module.
  - **Module list** (`CLAUDE.md`): replaced with the LLD's exact 14 modules
    in LLD order. Corrected three bootstrap errors: Sync is module 10 and
    Cutover is 11 (were swapped); SDK is not a module (it is the
    sdk-core/sdk-react packages); the cross-cutting modules are three
    distinct modules — Notification (12), Analytics (13), Audit (14) — not
    the inferred "Notifications & Webhooks" + "Audit, Observability &
    Reporting" pair. Implementation order updated to the LLD's; Sync remains
    built last.
  - **API envelope** (`packages/contracts/src/envelope.ts`): replaced the
    inferred `{ data, error, meta }` (always-present `data`/`error`, plus
    `tenantId`/`pagination` in meta) with the blueprint's canonical shape —
    success `{ data, meta }`, error `{ error: { code, message, details[] },
meta }`, `meta` always `{ requestId, timestamp }`. Added the
    `ApiErrorCode` taxonomy as a const union, `ApiErrorDetail`
    (`{ field, issue }`), and an `isApiSuccess` narrowing helper. No
    application consumers existed (response interceptor / exception filter /
    SDK client are still Module-1 placeholders), so only the contract and
    its doc comments changed.
  - **Tenant context resolution** (`CLAUDE.md`, `contracts/tenant.ts`):
    documented the blueprint's header contract precisely — `Authorization:
Bearer <token>`, `X-Tenant-Id: <tenant_uuid>`, `Idempotency-Key: <uuid>`
    on mutating workflows — and the app-level (non-RLS) resolution mechanism:
    validate `X-Tenant-Id` against the user's active memberships, reject with
    `AUTH_REQUIRED` or `TENANT_FORBIDDEN`. The auth guard itself is owned by
    the Identity module (built first) and is not yet implemented; this is the
    spec it must satisfy.
  - **npm scope**: confirmed `@pintle/*`. The docs name the product
    "Customer Migration Control Tower" with no brand rename, so no scope
    change was required.
  - **Repo layout**: scaffolded `infra/terraform/` and `infra/monitoring/`
    (README placeholders) to match the LLD's recommended
    `infra/{docker,terraform,monitoring}`. Documented the two intentional,
    doc-justified deviations from the LLD's illustrative sketch — `packages/db`
    (mandated by the blueprint) and `apps/docs-site` (additive, not in the LLD)
    — in `CLAUDE.md` rather than silently dropping them.
  - Removed `docs/design/ASSUMPTIONS.md` (fully reconciled) and refreshed
    `docs/design/README.md`, root `README.md`, and the `CLAUDE.md` provenance
    note to reflect that `/docs/design/` is now the realized single source of
    truth.
