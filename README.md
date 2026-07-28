# Migration Tower

> **An open-source migration control tower — the seam between Flatfile and
> Rocketlane that B2B SaaS implementation teams have been missing.**

Flatfile gets data _in_. Rocketlane tracks the _project_. Neither owns the
hard middle: turning a customer's messy source data into a validated,
mapped, reconciled, cut-over migration — with multi-tenant isolation, an
auditable trail, and an embeddable customer portal. **Migration Tower is that
middle.**

> ⚠️ **Status: bootstrapping (Module 1).** The monorepo, tooling, and shared
> contracts exist; packages are intentionally empty placeholders. The bootstrap
> has been reconciled against the canonical design docs in
> [`docs/design/`](docs/design/) — see [`CHANGELOG.md`](CHANGELOG.md).

---

## Architecture

A multi-tenant system: web apps and an embeddable SDK on top of a single HTTP
API, with heavy work pushed to idempotent BullMQ workers.


<img width="2816" height="1536" alt="pintle_architecture_diagram" src="https://github.com/user-attachments/assets/2d4c709b-1017-4990-846c-3e67f3683960" />

</br>
- **`services/api`** — the only writer of record. Every response uses the
  common envelope (`@migrationtower/contracts`); every protected route resolves
  tenant context in middleware.
- **Workers** (`worker-validation`, `worker-import`, `worker-sync`) — BullMQ
  consumers. Every job carries a `tenant_id` and an `idempotencyKey`, so retries
  are safe.
- **`packages/contracts`** — the canonical types shared by client, server, and
  workers (API envelope, tenant context, job descriptors).
- **Multi-tenancy** — every persisted row carries `tenant_id`; isolation is
  enforced at the repository layer, never left to handlers.

See [`CLAUDE.md`](CLAUDE.md) for the 14-module breakdown, conventions, and the
suggested implementation order, and [`docs/design/`](docs/design/) for the LLD,
database blueprint, and tech-stack matrix.

## Tech stack

Turborepo + pnpm workspaces · TypeScript 5.4+ · Node 20 LTS · PostgreSQL ·
Redis + BullMQ · S3-compatible object storage (MinIO locally) · Mailhog (local
mail). Web framework / API framework / ORM are pinned by `docs/design/tech-stack.csv`
(see [`CLAUDE.md`](CLAUDE.md) for current recommended defaults).

## Prerequisites

- **Node 20 LTS** (engines require `>=20`)
- **pnpm 10** (`corepack enable` to get the pinned version)
- **Docker + Docker Compose** (for local Postgres / Redis / MinIO / Mailhog)
- **Git**

## Installation (local development)

```bash
# 1. Clone
git clone https://github.com/CodeMuscle/migration-tower.git
cd migration-tower

# 2. Use the pinned pnpm
corepack enable

# 3. Install the workspace
pnpm install

# 4. Configure environment
cp .env.example .env

# 5. Start backing services (postgres, redis, minio, mailhog)
pnpm docker:up

# 6. Build everything
pnpm build
```

### Local service endpoints

| Service        | URL / Port              | Credentials                         |
| -------------- | ----------------------- | ----------------------------------- |
| PostgreSQL     | `localhost:5432`        | `migrationtower` / `migrationtower` |
| Redis          | `localhost:6379`        | —                                   |
| MinIO (S3 API) | `http://localhost:9000` | `migrationtower` / `migrationtower` |
| MinIO console  | `http://localhost:9001` | `migrationtower` / `migrationtower` |
| Mailhog UI     | `http://localhost:8025` | —                                   |

## Common commands

| Command                               | What it does                           |
| ------------------------------------- | -------------------------------------- |
| `pnpm dev`                            | Run all packages in watch mode (Turbo) |
| `pnpm build`                          | Build all packages                     |
| `pnpm lint`                           | Lint the workspace                     |
| `pnpm type-check`                     | Type-check the workspace               |
| `pnpm test`                           | Run tests                              |
| `pnpm format`                         | Format with Prettier                   |
| `pnpm docker:up` / `pnpm docker:down` | Start / stop local backing services    |

## Repository layout

```
apps/        control-plane-web · customer-portal · docs-site
packages/    contracts · ui · sdk-core · sdk-react · db · config/*
services/    api · worker-validation · worker-import · worker-sync
infra/docker local backing services
docs/design  LLD · database blueprint · tech-stack — read first
```

## Conventions

Enforced via shared `tsconfig` / `eslint` / `prettier` configs, Husky hooks, and
commitlint (**Conventional Commits**). The four non-negotiables — `tenant_id` on
every record, common envelope on every endpoint, tenant resolved via middleware,
idempotent BullMQ jobs — are detailed in [`CLAUDE.md`](CLAUDE.md).

## Production notes

This is an early bootstrap; the items below are the intended production posture,
implemented per-module rather than now:

- **Config** — all configuration via environment variables
  (see `.env.example`); no secrets in the repo. Use a secrets manager in
  deployed environments.
- **Database** — managed PostgreSQL with automated backups + PITR; migrations
  via `packages/db`, run as a release step, never auto-applied at boot.
- **Object storage** — real S3 (or compatible) replaces MinIO; per-tenant
  prefixes; least-privilege bucket policy.
- **Queues** — managed Redis with persistence; per-queue dead-letter handling;
  workers scale horizontally and are safe to restart (idempotency keys).
- **API** — stateless and horizontally scalable behind a load balancer;
  structured logs keyed by `requestId`; readiness/liveness probes.
- **Multi-tenancy** — tenant isolation enforced at the data layer and verified
  in tests; tenant context required on every protected route.
- **Observability** — request/job correlation IDs, metrics, and an audit log
  (Module 14).
- **CI/CD** — `pnpm install && pnpm build && pnpm lint && pnpm test` gate on
  every PR; containerized deploys per app/service.
- **Mail** — Mailhog locally; a real SMTP/email provider in production.

## License

TBD (open-source intent — to be finalized).
