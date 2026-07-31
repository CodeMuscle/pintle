/**
 * Validation worker integration test (LLD §7). A 10 000-row CSV with five
 * deliberately broken columns (one bad row class per rule) is fed through
 * the real rule engine + DB; we assert per-rule issue counts. Then we run
 * validation again against a second mapping version that flips
 * `isRequiredOverride=false` on `email`, and assert that the "required"
 * issues vanish while the others stay put.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let container: StartedPostgreSqlContainer;
let db: typeof import("@pintle/db");
let ValidationProcessor: typeof import("../dist/validation/validation.processor.js").ValidationProcessor;
let s3Mock: ReturnType<typeof mockClient<S3Client>>;

const ROW_COUNT = 10_000;
const EMPTY_EMAIL_ROWS = 100;
const DUPLICATE_ID_ROWS = 50;
const BAD_TIER_ROWS = 30;
const BAD_DATE_ROWS = 20;
const BAD_COUNTRY_ROWS = 40;

const tenantId = randomUUID();
const userId = randomUUID();
const projectId = randomUUID();
const dataSourceId = randomUUID();
const uploadId = randomUUID();
const batchId = randomUUID();
const snapshotId = randomUUID();
const destSchemaId = randomUUID();
const mappingVersionStrictId = randomUUID();
const mappingVersionRelaxedId = randomUUID();
const objectKey = `tenants/${tenantId}/projects/${projectId}/uploads/${uploadId}/customers.csv`;
const TIERS = ["gold", "silver", "bronze"] as const;

/**
 * id: number-unique-required. We keep IDs numeric for everyone so we don't
 *     blur uniqueness with type_mismatch. The first DUPLICATE_ID_ROWS rows
 *     get duplicated ids further down (rows i and i+5000 collide).
 * email: required string. EMPTY_EMAIL_ROWS rows have empty email.
 * tier: enum. BAD_TIER_ROWS rows have an invalid tier ("platinum").
 * joined_at: ISO date. BAD_DATE_ROWS rows have a bad date ("2024-13-99").
 * country: regex ^[A-Z]{2}$. BAD_COUNTRY_ROWS rows have "USA".
 */
function generateCsv(): string {
  const lines: string[] = ["id,email,tier,joined_at,country\n"];
  for (let i = 1; i <= ROW_COUNT; i++) {
    let id = i;
    if (i > 5000 && i <= 5000 + DUPLICATE_ID_ROWS) id = i - 5000; // duplicates
    const email = i <= EMPTY_EMAIL_ROWS ? "" : `user${i}@example.com`;
    const tier =
      i > EMPTY_EMAIL_ROWS && i <= EMPTY_EMAIL_ROWS + BAD_TIER_ROWS ? "platinum" : TIERS[i % 3];
    const joined =
      i > EMPTY_EMAIL_ROWS + BAD_TIER_ROWS && i <= EMPTY_EMAIL_ROWS + BAD_TIER_ROWS + BAD_DATE_ROWS
        ? "2024-13-99"
        : `2024-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    const country =
      i > EMPTY_EMAIL_ROWS + BAD_TIER_ROWS + BAD_DATE_ROWS &&
      i <= EMPTY_EMAIL_ROWS + BAD_TIER_ROWS + BAD_DATE_ROWS + BAD_COUNTRY_ROWS
        ? "USA"
        : "US";
    lines.push(`${id},${email},${tier},${joined},${country}\n`);
  }
  return lines.join("");
}

function mappingJson(emailRequiredOverride: boolean | null) {
  return {
    mappings: [
      {
        sourceFieldKey: "id",
        destinationFieldKey: "id",
        mappingType: "direct",
        config: { unique: true },
      },
      {
        sourceFieldKey: "email",
        destinationFieldKey: "email",
        mappingType: "direct",
        isRequiredOverride: emailRequiredOverride,
      },
      {
        sourceFieldKey: "tier",
        destinationFieldKey: "tier",
        mappingType: "direct",
      },
      {
        sourceFieldKey: "joined_at",
        destinationFieldKey: "joined_at",
        mappingType: "direct",
      },
      {
        sourceFieldKey: "country",
        destinationFieldKey: "country",
        mappingType: "direct",
        config: { pattern: "^[A-Z]{2}$" },
      },
    ],
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.S3_BUCKET = "migration-tower";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "x";
  process.env.S3_SECRET_ACCESS_KEY = "x";
  const env = { ...process.env };

  execSync("pnpm --filter @pintle/db build", { cwd: repoRoot, env, stdio: "inherit" });
  execSync("pnpm --filter @pintle/db exec prisma migrate deploy", {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  execSync("pnpm --filter @pintle/services-common build", {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  execSync("pnpm --filter @pintle/worker-validation build", {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  db = await import("@pintle/db");
  ({ ValidationProcessor } = await import("../dist/validation/validation.processor.js"));

  // Seed: tenant, user, project, data_source, upload, batch, snapshot,
  // destination schema (global), and two mapping_versions (strict + relaxed).
  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: "ValT",
      slug: `valt-${tenantId.slice(0, 8)}`,
      plan: "growth",
      status: "active",
      primaryRegion: "ap-south-1",
    },
  });
  await db.prisma.user.create({
    data: { id: userId, email: `u-${userId}@x`, fullName: "U", status: "active" },
  });
  await db.prisma.migrationProject.create({
    data: {
      id: projectId,
      tenantId,
      name: "P",
      customerName: "C",
      projectCode: "VAL-001",
      status: "draft",
      currentStage: "validation",
      migrationType: "file",
      targetEnvironment: "sandbox",
      targetProductType: "crm",
      ownerUserId: userId,
    },
  });
  await db.prisma.dataSource.create({
    data: {
      id: dataSourceId,
      tenantId,
      projectId,
      sourceType: "csv",
      name: "customers.csv",
      status: "uploaded",
    },
  });
  await db.prisma.sourceUpload.create({
    data: {
      id: uploadId,
      tenantId,
      projectId,
      dataSourceId,
      objectKey,
      originalFilename: "customers.csv",
      mimeType: "text/csv",
      sizeBytes: BigInt(0),
      checksumSha256: "",
      uploadStatus: "uploaded",
      uploadedBy: userId,
      uploadedAt: new Date(),
    },
  });
  await db.prisma.sourceBatch.create({
    data: {
      id: batchId,
      tenantId,
      projectId,
      dataSourceId,
      sourceUploadId: uploadId,
      batchType: "initial",
      status: "parsed",
    },
  });
  await db.prisma.sourceSchemaSnapshot.create({
    data: {
      id: snapshotId,
      tenantId,
      projectId,
      batchId,
      version: 1,
      detectedFormat: "csv",
      headerRowIndex: 0,
      rowSampleCount: 5,
      schemaJson: { columns: [] },
    },
  });
  await db.prisma.destinationSchema.create({
    data: {
      id: destSchemaId,
      tenantId: null,
      productType: "crm",
      version: "1",
      status: "active",
      schemaJson: {
        fields: [
          { fieldKey: "id", dataType: "number", isRequired: true },
          { fieldKey: "email", dataType: "string", isRequired: true },
          { fieldKey: "tier", dataType: "enum", isRequired: true, enumValues: [...TIERS] },
          { fieldKey: "joined_at", dataType: "date", isRequired: true },
          { fieldKey: "country", dataType: "string", isRequired: true },
        ],
      },
    },
  });
  await db.prisma.mappingVersion.create({
    data: {
      id: mappingVersionStrictId,
      tenantId,
      projectId,
      sourceSnapshotId: snapshotId,
      destinationSchemaId: destSchemaId,
      versionNumber: 1,
      status: "published",
      mappingJson: mappingJson(null),
      publishedBy: userId,
      publishedAt: new Date(),
    },
  });
  await db.prisma.mappingVersion.create({
    data: {
      id: mappingVersionRelaxedId,
      tenantId,
      projectId,
      sourceSnapshotId: snapshotId,
      destinationSchemaId: destSchemaId,
      versionNumber: 2,
      status: "published",
      mappingJson: mappingJson(false), // email no longer required
      publishedBy: userId,
      publishedAt: new Date(),
    },
  });

  s3Mock = mockClient(S3Client);
  const csv = generateCsv();
  s3Mock.on(GetObjectCommand).callsFake(() => ({
    Body: Readable.from(Buffer.from(csv)),
  }));
}, 240_000);

afterAll(async () => {
  s3Mock?.restore();
  await db?.disconnectAll();
  await container?.stop();
});

async function createRun(mappingVersionId: string): Promise<string> {
  const row = await db.prisma.validationRun.create({
    data: {
      tenantId,
      projectId,
      batchId,
      mappingVersionId,
      sourceSnapshotId: snapshotId,
      destinationSchemaId: destSchemaId,
      status: "queued",
      triggeredBy: userId,
    },
  });
  return row.id;
}

async function countsByRule(runId: string): Promise<Record<string, number>> {
  const groups = await db.prisma.validationIssue.groupBy({
    by: ["ruleKey"],
    where: { runId },
    _count: { _all: true },
  });
  return Object.fromEntries(groups.map((g) => [g.ruleKey, g._count._all]));
}

describe("validation rule engine — 10k row CSV with 5 broken columns", () => {
  it("produces the expected per-rule issue counts; re-run with relaxed mapping drops 'required'", async () => {
    const noopLogger = {
      info() {},
      debug() {},
      warn() {},
      error() {},
      trace() {},
    } as unknown as ConstructorParameters<typeof ValidationProcessor>[0];
    const processor = new ValidationProcessor(noopLogger);

    // Strict run.
    const runStrictId = await createRun(mappingVersionStrictId);
    const strictResult = await processor.runDirect({
      runId: runStrictId,
      tenantId,
      projectId,
      batchId,
      sourceSnapshotId: snapshotId,
      destinationSchemaId: destSchemaId,
      mappingVersionId: mappingVersionStrictId,
      triggeredBy: userId,
    });
    expect(strictResult.rowsScanned).toBe(ROW_COUNT);

    const strictCounts = await countsByRule(runStrictId);
    expect(strictCounts.required).toBe(EMPTY_EMAIL_ROWS);
    expect(strictCounts.uniqueness).toBe(DUPLICATE_ID_ROWS);
    expect(strictCounts.enum).toBe(BAD_TIER_ROWS);
    expect(strictCounts.date_format).toBe(BAD_DATE_ROWS);
    expect(strictCounts.regex).toBe(BAD_COUNTRY_ROWS);

    const runRow = await db.prisma.validationRun.findUniqueOrThrow({ where: { id: runStrictId } });
    expect(runRow.status).toBe("completed");
    expect(runRow.rowsScanned).toBe(ROW_COUNT);
    expect(runRow.errorCount).toBe(
      EMPTY_EMAIL_ROWS + DUPLICATE_ID_ROWS + BAD_TIER_ROWS + BAD_DATE_ROWS + BAD_COUNTRY_ROWS,
    );

    // Relaxed run — email no longer required → "required" issues vanish, the rest stay.
    const runRelaxedId = await createRun(mappingVersionRelaxedId);
    await processor.runDirect({
      runId: runRelaxedId,
      tenantId,
      projectId,
      batchId,
      sourceSnapshotId: snapshotId,
      destinationSchemaId: destSchemaId,
      mappingVersionId: mappingVersionRelaxedId,
      triggeredBy: userId,
    });
    const relaxedCounts = await countsByRule(runRelaxedId);
    expect(relaxedCounts.required ?? 0).toBe(0);
    expect(relaxedCounts.uniqueness).toBe(DUPLICATE_ID_ROWS);
    expect(relaxedCounts.enum).toBe(BAD_TIER_ROWS);
    expect(relaxedCounts.date_format).toBe(BAD_DATE_ROWS);
    expect(relaxedCounts.regex).toBe(BAD_COUNTRY_ROWS);
  }, 180_000);
});
