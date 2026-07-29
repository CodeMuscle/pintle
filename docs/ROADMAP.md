# Pintle — Product Roadmap & Strategy

> Living strategy doc. The canonical _design_ lives in `docs/design/` (LLD,
> database blueprint, tech-stack). This file captures **product direction,
> competitive positioning, and build sequencing** decided during planning.
> Where this conflicts with `docs/design/`, the design docs win for
> implementation detail; this file owns _what to build and in what order_.

Last updated: 2026-07-28.

---

## 1. What Pintle is (one paragraph)

Pintle is the customer-data migration platform you can **rehearse and undo** —
a self-hostable, multi-tenant cutover engine that simulates a migration against
live data, diffs the result (reconciliation), commits it atomically, and rolls
it back if anything breaks. The reversible-cutover guarantee is the product;
every other capability is an expansion layer that routes _through_ its gates,
never around them.

**Positioning line:** _"Flatfile gets the data in. Rocketlane runs the project.
Pintle moves the data into production — verifiably, reversibly, on your own
infra — the part neither of them does."_

---

## 2. Glossary (plain-language)

- **Moat** — the defensible thing competitors can't easily copy. Here: the
  reversible-cutover guarantee + the accumulating recipe library.
- **Cutover** — the moment the new system becomes the live source of truth.
- **Shadow run / rehearsal** — running the full migration into a throwaway copy
  of the destination, to inspect the result without risk.
- **Reconciliation** — diffing the shadow result against the source of truth
  (row counts, field deltas, referential integrity, transform correctness).
  Produces a pass/fail report.
- **Reconciliation gate** — cutover stays _locked_ until reconciliation passes
  or a human explicitly overrides with a logged reason.
- **Snapshot** — a point-in-time capture of the live destination before cutover;
  enables rollback.
- **Rollback** — restore the pre-cutover snapshot; undo a live migration.
  Verified byte-identical by checksum.
- **Blast radius** — a preview of exactly which records/tables change, and the
  cost to reverse, shown before any live write.
- **Idempotent** — re-running the same job produces the same result; safe to
  resume, no double-processing.
- **Recipe (migration-as-code)** — the versioned, reviewable artifact describing
  a whole migration. Reusable across tenants sharing a source system.
- **Connector** — a plugin teaching Pintle to read/write one system, built
  against a fixed interface so anyone can add one.

---

## 3. The pipeline (organizing spine)

Every feature attaches to one of five stages. If it doesn't, it's feature creep.

1. **Connect** — read from source, write to destination.
2. **Map** — align source fields/objects to the destination schema (+ transforms).
3. **Validate** — enforce rules, types, referential integrity → issues.
4. **Rehearse / Reconcile** — shadow-run + diff against live data.
5. **Cut over / Roll back** — atomic, snapshot-backed, reversible go-live.

---

## 4. Enterprise workflow — the "Bank of America" model

Large, confidential, minimal-workforce migrations (the kind teams build in
secret for one client). Pintle productizes exactly this. Three phases:

**Phase 1 — Clone & snapshot (slow, careful).** Connector `snapshot()` captures
a byte-exact, checksummed, point-in-time copy of the source into the customer's
_own_ object storage (encrypted, customer keys). Chunked, cursor-paginated,
parallelized; CDC tracks deltas so the mountain is cloned once. This is the
backup, the rollback point, and the rehearsal input. It _should_ be slow —
correctness is bought here.

**Phase 2 — Rehearse, reconcile, intervene (offline).** The full migration runs
into an isolated shadow copy; reconciliation surfaces only the records that
don't reconcile. Devs work an **exception queue** — never the happy-path
millions. Each finding is an issue (`source → proposed transform → destination`)
a dev can **fix at the rule** (edit the recipe transform; re-runs only that
slice), **fix the record**, or **scope out** (audited exclusion). Every fix is a
versioned recipe change with a git-like diff.

**Phase 3 — Cutover (fast).** Because Phase 2 produced a verified dataset, the
live cutover is a short atomic promotion behind a minimal freeze window, with a
blast-radius preview and one-click rollback.

**Why a handful of devs can run a bank-scale migration:** AI proposes mappings/
transforms (gated); recipe reuse across similar subsystems; humans adjudicate
only the exception queue. The engine does the mechanical 99%.

---

## 5. Compliance & self-hosting posture

- Pintle is a **data processor**; the customer is the **controller** (DPA). GDPR
  / CCPA / SOC 2 / HIPAA framing. Self-hosting takes most of the surface out of
  scope entirely.
- **Runs inside the customer's perimeter** — Docker/Helm on their infra, their
  Postgres, their object store, their KMS keys. Air-gap-capable (self-hosted LLM
  or AI-off; the engine is fully deterministic without AI).
- **PII masking** in shadow/non-prod runs (data minimization).
- **RBAC + separation of duties** (recipe author ≠ cutover approver) + immutable
  audit log exportable to SIEM.
- The reconciliation gate means no one — human or agent — migrates blind.

### Storage abstraction (v1 build, approved)

Introduce a `StorageProvider` interface (`put/get/presign/delete`) with drivers:
**local filesystem · MinIO · S3 · Cloudflare R2 · B2/GCS/Azure**. Default to
MinIO/filesystem; never hard-depend on AWS. Makes self-host trivial and keeps
build/test cost at ~$0 (MinIO local). R2 (zero egress) for any hosted tier.

---

## 6. Connector strategy — in-house, SDK-first

- **Drop Merge.dev from core** — paid, cloud-only, third-party; contradicts the
  in-house + self-host + zero-cost principles. May survive as an _optional_
  connector someone enables, never a dependency.
- **Connector SDK first** — typed `read/schema/write/snapshot/reverse`.
- **Ship ~5 in-house reference connectors** (Postgres, CSV/file, Salesforce,
  HubSpot, +1 by demand). Don't hand-build 50 upfront.
- **Connector-authoring docs + scaffolding CLI** so customers/community cover
  the long tail. That's how the catalog reaches 50+ without 50× the work.
- **"Editions" (NetSuite/Workday) = pre-built destination-schema recipes**, a
  data asset, not a hand-built product line.

---

## 7. AI: propose → verify → approve

- **AI proposes, deterministic engine verifies, human approves.** No AI output
  reaches live cutover without passing the same shadow + reconciliation gates a
  human mapping would.
- **Verifier pipeline** — each proposal runs an ordered set of independent
  verifiers (type/schema → referential integrity → business rule → shadow diff →
  reconciliation → confidence score). Each verifier is a plugin; compose
  different pipelines per step.
- **Per-niche modularity** — rule packs (SaaS-CRM, e-commerce catalog,
  healthcare records…), a reusable transform library, all as typed plugins in
  tenant-scoped registries. Same philosophy as the Connector SDK, applied to
  rules + transforms + verifiers. Modular by default.
- **Provider abstraction** — Claude / GPT / Gemini + **self-hosted Ollama/vLLM**
  for data-residency buyers. Per-tenant model config + cost metering + prompt/
  response audit.

---

## 8. Competitive teardown

**Flatfile = the front door** (data onboarding: Workbooks, AI mapping, Transform,
Collaboration). Stops at import — no rehearsal, no reconciliation, no reversible
cutover, cloud-only. **Rocketlane = the project wrapper** (PSA: SOW→plan, portal,
resourcing, billing, Nitro agents). By their own words, _never touches the data_.

The middle — safely moving data into production, reversibly — is unowned. That's
Pintle.

| Competitor feature        | Pintle's answer                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Flatfile Workbooks        | Reconciliation workbench — spreadsheet-like, but on the diff vs live production.                      |
| Flatfile AI mapping       | Same, but _gated_ — can't reach prod without passing reconciliation.                                  |
| Flatfile Config (no-code) | Visual recipe builder.                                                                                |
| Flatfile Collaboration    | Issues module (owners, comments, status).                                                             |
| Flatfile Security         | **Self-hostable** — data never leaves customer infra. Decisive win.                                   |
| Flatfile Editions         | Pre-built destination-schema recipes + connector SDK.                                                 |
| Rocketlane project mgmt   | Native delivery surface (portal + status). Optional attachment to Rocketlane for teams already on it. |

### Product stance — everything in-house by default (decided)

Pintle owns **all** of it natively: the import/onboarding UX, the cutover
engine, and the delivery/portal surface. No hard dependency on Flatfile or
Rocketlane — a customer should never _need_ another product to use Pintle.

The only role the other two play is **optional side-attachments**: import
connectors for teams who _already have data or projects living in Flatfile or
Rocketlane_ and want to pull it in. They are ingest sources, not requirements —
enabled per tenant, never a dependency. This keeps the "self-hostable, in-house,
data never leaves your infra" promise intact.

### Build order — in-house, but staged (not all at once)

Owning it all natively doesn't mean building it all at once — that ships three
mediocre halves. Build the in-house suite **wedge → expand from the hard core
outward** (the cutover engine is the piece competitors can't bolt on later):

1. **Pintle core** — win the cutover wedge.
2. **Native onboarding/import UX + embeddable widgets** (`sdk-core`/`sdk-react`
   already exist) — the Flatfile-class capability, in-house. Optional
   Flatfile-import attachment for existing-data teams.
3. **Native delivery surface** — client portal + status + milestones. **Not** a
   full PSA (billing/resourcing/time-tracking) — that's commodity that dilutes
   the wedge. Optional Rocketlane attachment for teams already on it.
4. **Code-migration track** — see §9.

Each stage ships something whole + sellable and funds the next.

---

## 9. Code-migration adjacency (new track, user-requested)

Distinct from data migration: refactor/port **application source code**
(Moderne / OpenRewrite / Codemod territory), not customer data. Genuinely
demanded ("total migration: data _and_ code"). Build as its own capability track
sharing the control-tower shell — the rehearse → review → cutover framing
applies to code too (run the transform, diff it, dev intervenes line-by-line,
apply). Bigger than a connector; slots as its own tier. Until built, Pintle can
_orchestrate and track_ an external code-migration job and surface status in the
same tower.

---

## 10. Scale ceiling & upgrade path

Today's BullMQ + Postgres stack handles low-millions of rows comfortably. For
true enterprise scale (billions of rows, hundreds of tables) the design
anticipates these seams — build when demand arrives, not before:

- Externalized orchestration (Temporal / Step Functions) for very long runs.
- Sharded / parallel extraction; partition by tenant/object.
- CDC for deltas (minimizes re-clone + freeze window).
- Snapshot storage tiering + cold-storage offload for cost.
- OpenTelemetry across every stage.

---

## 11. Tiered roadmap

**v1 (core — the product):**
Modules 1–14 · **Safety Layer** (shadow run, reconciliation gate, reversible
cutover, recipes — the backbone, IN v1) · storage abstraction · Connector SDK +
2–3 reference connectors · TS SDK · Migrations frontend screens.

**Tier A — expansion (adoption + enterprise):**
AI provider abstraction + verifier pipeline · MCP server + client · webhooks/
event stream · Slack app · OpenTelemetry + immutable audit log · RBAC/SSO ·
recipe library · reconciliation diff UI · **record-level intervention
workbench** (promoted — central to the enterprise use case).

**Tier B — standout demo-landers:**
Blast-radius preview · recipe marketplace · migration readiness score · sandbox
mode (synthetic data) · time-travel / point-in-time restore · PII masking.

**Tier C — moonshot (guard against bloat):**
Autonomous agentic migration (up to the human gate) · code-migration track ·
iPaaS connectors · reverse-ETL destinations · SOC 2.

---

## 12. Build sequencing

**Design-system-first** (avoids rebuilding screens):

- **Phase 0 — Design foundation** (Hallmark): design language + core component
  library + `tokens.json` (Figma-importable) + design-doc surface.
- **Phase 1 — v1 core** on the new system: backend Modules 9–14, Safety Layer,
  storage abstraction, Migrations screens (one spec/plan each: Projects → Upload
  → Mapping → Validation/Issues).
- **Phase 2 — Surfaces (parallel):** product landing page (refs: paper.design,
  browserops.ai) + Vercel-style docs site (`apps/docs-site`).
- **Phase 3 — Tier A**, then **Tier B**, then **Tier C**.

---

## 13. Brand

- Name: **Pintle** — the pin a hinge/rudder pivots on; the fulcrum that joins
  source + destination and lets you steer the cutover. Rare, ownable.
- Mark: "Pivot Pin" — central pin + two hinge-knuckle hooks in 180° rotational
  symmetry (rotate a half-turn → identical = reversibility). `docs/brand/`.
- Accent: signal-teal `#0FA893` (the reconciliation-passed / green-gate colour).
- npm scope `@pintle/*`; repo `github.com/CodeMuscle/pintle`.

---

## 14. Open decisions

- Backend hosting target (Render / Fly / Railway) for a working deploy — Vercel
  handles frontend only.
- Order of the two queued builds: storage abstraction vs. first Migrations
  screen (after Phase 0 design foundation).
- Whether the landing page + docs site share one Next app or stay separate.
