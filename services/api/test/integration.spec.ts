/**
 * Integration tests — real Postgres via testcontainers, the committed Prisma
 * migrations, and the real tenant-scoped client. Covers the three guarantees
 * the brief calls out: tenant-scoping isolation, stage-machine enforcement,
 * and per-tenant project_code uniqueness.
 *
 * Services are exercised directly (constructed with lightweight stand-ins for
 * the Nest-injected EventBus/PinoLogger) so the test targets data behaviour,
 * not the HTTP wiring (which the envelope interceptor/filter cover).
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let container: StartedPostgreSqlContainer;
// Loaded dynamically AFTER DATABASE_URL points at the container.
let db: typeof import("@pintle/db");
let ProjectsService: typeof import("../dist/projects/projects.service.js").ProjectsService;
let MappingService: typeof import("../dist/mapping/mapping.service.js").MappingService;

const noopLogger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  trace() {},
} as unknown as ConstructorParameters<typeof ProjectsService>[2];
const noopEvents = {
  publish: async () => {},
} as unknown as ConstructorParameters<typeof ProjectsService>[1];

function serviceFor(tenantId: string) {
  const prismaStub = {
    base: db.prisma,
    tenant: db.prismaForTenant(tenantId),
  } as unknown as ConstructorParameters<typeof ProjectsService>[0];
  return new ProjectsService(prismaStub, noopEvents, noopLogger);
}

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const ctxA = { tenantId: tenantA, userId: userA, roles: ["owner"] };
const ctxB = { tenantId: tenantB, userId: userB, roles: ["owner"] };

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };
  // Build deps + api (so the dist we import matches source) and apply
  // migrations to the fresh container.
  execSync("pnpm --filter @pintle/db build", { cwd: repoRoot, env, stdio: "inherit" });
  execSync("pnpm --filter @pintle/db exec prisma migrate deploy", {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  execSync("pnpm --filter @pintle/api build", { cwd: repoRoot, env, stdio: "inherit" });

  db = await import("@pintle/db");
  ({ ProjectsService } = await import("../dist/projects/projects.service.js"));
  ({ MappingService } = await import("../dist/mapping/mapping.service.js"));

  // Minimal fixtures: two tenants, one user each (FK targets for
  // ownerUserId/changedBy/actorUserId).
  await db.prisma.tenant.createMany({
    data: [
      {
        id: tenantA,
        name: "Tenant A",
        slug: "tenant-a",
        plan: "growth",
        status: "active",
        primaryRegion: "ap-south-1",
      },
      {
        id: tenantB,
        name: "Tenant B",
        slug: "tenant-b",
        plan: "growth",
        status: "active",
        primaryRegion: "ap-south-1",
      },
    ],
  });
  await db.prisma.user.createMany({
    data: [
      { id: userA, email: "a@example.com", fullName: "User A", status: "active" },
      { id: userB, email: "b@example.com", fullName: "User B", status: "active" },
    ],
  });
});

afterAll(async () => {
  await db?.disconnectAll();
  await container?.stop();
});

describe("project_code uniqueness (per tenant)", () => {
  it("rejects a duplicate code in the same tenant but allows it across tenants", async () => {
    const svcA = serviceFor(tenantA);
    const svcB = serviceFor(tenantB);
    const base = {
      name: "Proj",
      customerName: "Cust",
      projectCode: "DUP-001",
      migrationType: "file" as const,
      targetProductType: "crm",
      targetEnvironment: "sandbox" as const,
      ownerUserId: userA,
    };

    await svcA.create(ctxA, base, "req-1");
    await expect(svcA.create(ctxA, base, "req-2")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Same code, different tenant → allowed.
    await expect(
      svcB.create(ctxB, { ...base, ownerUserId: userB }, "req-3"),
    ).resolves.toMatchObject({ projectCode: "DUP-001" });
  });
});

describe("stage state machine (server-enforced)", () => {
  it("rejects an illegal jump and accepts the legal next stage", async () => {
    const svcA = serviceFor(tenantA);
    const project = await svcA.create(
      ctxA,
      {
        name: "SM",
        customerName: "Cust",
        projectCode: "SM-001",
        migrationType: "file",
        targetProductType: "crm",
        targetEnvironment: "sandbox",
        ownerUserId: userA,
      },
      "req",
    );

    // setup → mapping skips ingestion → rejected.
    await expect(
      svcA.advanceStage(ctxA, project.id, { toStage: "mapping" }, "req"),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // setup → ingestion is legal.
    const ok = await svcA.advanceStage(
      ctxA,
      project.id,
      { toStage: "ingestion", reason: "files uploaded" },
      "req",
    );
    expect(ok).toMatchObject({ currentStage: "ingestion", status: "active" });

    // any stage → blocked (side-branch).
    const blocked = await svcA.advanceStage(
      ctxA,
      project.id,
      { toStage: "blocked", reason: "client paused" },
      "req",
    );
    expect(blocked.status).toBe("blocked");
  });
});

describe("mapping publish + diff workflow", () => {
  const tenantC = randomUUID();
  const userC = randomUUID();
  const projectC = randomUUID();
  const snapshotC = randomUUID();
  const ctxC = { tenantId: tenantC, userId: userC, roles: ["owner"] };

  function mappingServiceFor(tenantId: string) {
    const prismaStub = {
      base: db.prisma,
      tenant: db.prismaForTenant(tenantId),
    } as unknown as ConstructorParameters<typeof MappingService>[0];
    return new MappingService(prismaStub, noopEvents, noopLogger);
  }

  beforeAll(async () => {
    await db.prisma.tenant.create({
      data: {
        id: tenantC,
        name: "Tenant C",
        slug: "tenant-c",
        plan: "growth",
        status: "active",
        primaryRegion: "ap-south-1",
      },
    });
    await db.prisma.user.create({
      data: { id: userC, email: "c@example.com", fullName: "User C", status: "active" },
    });
    await db.prisma.migrationProject.create({
      data: {
        id: projectC,
        tenantId: tenantC,
        name: "Map",
        customerName: "C",
        projectCode: "MAP-001",
        status: "draft",
        currentStage: "mapping",
        migrationType: "file",
        targetEnvironment: "sandbox",
        targetProductType: "crm",
        ownerUserId: userC,
      },
    });
    // Build the FK chain the worker normally writes: data_source →
    // source_upload → source_batch → source_schema_snapshot.
    const dataSourceC = randomUUID();
    const uploadC = randomUUID();
    const batchC = randomUUID();
    await db.prisma.dataSource.create({
      data: {
        id: dataSourceC,
        tenantId: tenantC,
        projectId: projectC,
        sourceType: "csv",
        name: "fixtures.csv",
        status: "uploaded",
      },
    });
    await db.prisma.sourceUpload.create({
      data: {
        id: uploadC,
        tenantId: tenantC,
        projectId: projectC,
        dataSourceId: dataSourceC,
        objectKey: `tenants/${tenantC}/projects/${projectC}/uploads/${uploadC}/fixtures.csv`,
        originalFilename: "fixtures.csv",
        mimeType: "text/csv",
        sizeBytes: BigInt(0),
        checksumSha256: "",
        uploadStatus: "uploaded",
        uploadedBy: userC,
        uploadedAt: new Date(),
      },
    });
    await db.prisma.sourceBatch.create({
      data: {
        id: batchC,
        tenantId: tenantC,
        projectId: projectC,
        dataSourceId: dataSourceC,
        sourceUploadId: uploadC,
        batchType: "initial",
        status: "parsed",
      },
    });
    await db.prisma.sourceSchemaSnapshot.create({
      data: {
        id: snapshotC,
        tenantId: tenantC,
        projectId: projectC,
        batchId: batchC,
        version: 1,
        detectedFormat: "csv",
        headerRowIndex: 0,
        rowSampleCount: 2,
        schemaJson: {
          columns: [
            { fieldKey: "email", dataType: "string", nullable: false },
            { fieldKey: "name", dataType: "string", nullable: false },
            { fieldKey: "company", dataType: "string", nullable: true },
          ],
        },
      },
    });
    // Global destination schema for CRM (mirrors the demo seed).
    const existing = await db.prisma.destinationSchema.findFirst({
      where: { tenantId: null, productType: "crm", status: "active" },
    });
    if (!existing) {
      await db.prisma.destinationSchema.create({
        data: {
          tenantId: null,
          productType: "crm",
          version: "1",
          status: "active",
          schemaJson: {
            fields: [
              { fieldKey: "email", dataType: "string", isRequired: true },
              { fieldKey: "fullName", dataType: "string", isRequired: true },
              { fieldKey: "company", dataType: "string", isRequired: false },
              { fieldKey: "status", dataType: "enum", isRequired: true },
            ],
          },
        },
      });
    }
  });

  it("publish v1, edit drafts, publish v2, diff returns the expected delta", async () => {
    const svc = mappingServiceFor(tenantC);
    const initial = await svc.getMappings(ctxC, projectC);
    expect(initial.destinationSchemaId).toBeTruthy();
    expect(initial.sourceSnapshotId).toBe(snapshotC);
    const destSchemaId = initial.destinationSchemaId!;

    // v1 drafts: two direct mappings.
    await svc.upsertMappings(
      ctxC,
      projectC,
      {
        sourceSnapshotId: snapshotC,
        destinationSchemaId: destSchemaId,
        mappings: [
          { sourceFieldKey: "email", destinationFieldKey: "email", mappingType: "direct" },
          { sourceFieldKey: "name", destinationFieldKey: "fullName", mappingType: "direct" },
        ],
      },
      "req-v1",
    );
    let view = await svc.getMappings(ctxC, projectC);
    const v1Fingerprint = view.drafts.map((d) => d.updatedAt).reduce((a, b) => (a > b ? a : b));
    const v1 = await svc.publish(ctxC, projectC, v1Fingerprint, {}, "req-pub1");
    expect(v1.versionNumber).toBe(1);

    // Edit drafts: remove email, change fullName to transform (uppercase), add company.
    const upperRule = view.transformRules.find((r) => r.ruleKey === "uppercase");
    expect(upperRule).toBeTruthy();
    await svc.upsertMappings(
      ctxC,
      projectC,
      {
        sourceSnapshotId: snapshotC,
        destinationSchemaId: destSchemaId,
        mappings: [
          {
            sourceFieldKey: "name",
            destinationFieldKey: "fullName",
            mappingType: "transform",
            transformRuleId: upperRule!.id,
          },
          { sourceFieldKey: "company", destinationFieldKey: "company", mappingType: "direct" },
        ],
      },
      "req-v2",
    );
    view = await svc.getMappings(ctxC, projectC);
    const v2Fingerprint = view.drafts.map((d) => d.updatedAt).reduce((a, b) => (a > b ? a : b));
    const v2 = await svc.publish(ctxC, projectC, v2Fingerprint, {}, "req-pub2");
    expect(v2.versionNumber).toBe(2);

    // Diff v1 → v2.
    const diff = await svc.diffVersions(ctxC, projectC, { from: 1, to: 2 });
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.added.map((e) => e.destinationFieldKey).sort()).toEqual(["company"]);
    expect(diff.removed.map((e) => e.destinationFieldKey).sort()).toEqual(["email"]);
    expect(diff.changed.map((e) => e.destinationFieldKey).sort()).toEqual(["fullName"]);
    const fullNameChange = diff.changed.find((e) => e.destinationFieldKey === "fullName");
    expect(fullNameChange?.from?.mappingType).toBe("direct");
    expect(fullNameChange?.to?.mappingType).toBe("transform");
  });
});

describe("tenant-scoping isolation", () => {
  it("a project from tenant B is not visible to tenant A (404)", async () => {
    const svcB = serviceFor(tenantB);
    const svcA = serviceFor(tenantA);
    const projB = await svcB.create(
      ctxB,
      {
        name: "Secret",
        customerName: "Cust",
        projectCode: "ISO-001",
        migrationType: "file",
        targetProductType: "crm",
        targetEnvironment: "sandbox",
        ownerUserId: userB,
      },
      "req",
    );

    await expect(svcA.get(ctxA, projB.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });
});
