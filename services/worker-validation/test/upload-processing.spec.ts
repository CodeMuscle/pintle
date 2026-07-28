/**
 * Worker integration test: a 5000-row CSV through the upload-processing
 * processor against a real Postgres (testcontainers) and a mocked S3
 * (aws-sdk-client-mock). The processor's `runDirect()` lets us skip the
 * BullMQ Worker plumbing — that path is exercised by the BullMQ producer in
 * the API; here we lock down the parse + schema-inference + DB-write logic.
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
let UploadProcessingProcessor: typeof import("../dist/upload-processing/upload-processing.processor.js").UploadProcessingProcessor;
let s3Mock: ReturnType<typeof mockClient<S3Client>>;

const tenantId = randomUUID();
const userId = randomUUID();
const projectId = randomUUID();
const batchId = randomUUID();
const uploadId = randomUUID();
const dataSourceId = randomUUID();
const objectKey = `tenants/${tenantId}/projects/${projectId}/uploads/${uploadId}/customers.csv`;

function generateCsv(rows: number): string {
  const header = "id,email,active,joined_at,tier\n";
  const tiers = ["gold", "silver", "bronze"];
  const parts: string[] = [header];
  for (let i = 1; i <= rows; i++) {
    const month = String((i % 9) + 1).padStart(2, "0");
    const day = String((i % 27) + 1).padStart(2, "0");
    parts.push(
      `${i},user${i}@example.com,${i % 2 === 0 ? "true" : "false"},2024-${month}-${day},${tiers[i % 3]}\n`,
    );
  }
  return parts.join("");
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
  ({ UploadProcessingProcessor } =
    await import("../dist/upload-processing/upload-processing.processor.js"));

  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: "T",
      slug: `t-${tenantId.slice(0, 8)}`,
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
      projectCode: "CSV-001",
      status: "draft",
      currentStage: "ingestion",
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
      status: "queued",
    },
  });

  s3Mock = mockClient(S3Client);
  const csv = generateCsv(5000);
  s3Mock.on(GetObjectCommand).callsFake(() => ({
    Body: Readable.from(Buffer.from(csv)),
  }));
}, 240_000);

afterAll(async () => {
  s3Mock?.restore();
  await db?.disconnectAll();
  await container?.stop();
});

describe("upload-processing parse + schema inference", () => {
  it("parses 5000 rows, infers per-column types, writes snapshot v1", async () => {
    const noopLogger = {
      info() {},
      debug() {},
      warn() {},
      error() {},
      trace() {},
    } as unknown as ConstructorParameters<typeof UploadProcessingProcessor>[0];
    const processor = new UploadProcessingProcessor(noopLogger);

    const progressTicks: number[] = [];
    const result = await processor.runDirect(
      { tenantId, projectId, batchId, uploadId, objectKey, sourceType: "csv" },
      async (rows) => {
        progressTicks.push(rows);
      },
    );

    expect(result.rowCount).toBe(5000);

    const snap = await db.prisma.sourceSchemaSnapshot.findUnique({
      where: { id: result.snapshotId },
    });
    expect(snap).toBeTruthy();
    expect(snap!.version).toBe(1);
    expect(snap!.detectedFormat).toBe("csv");

    const cols = (
      snap!.schemaJson as {
        columns: Array<{ fieldKey: string; dataType: string; enumValues?: string[] }>;
      }
    ).columns;
    const byKey = Object.fromEntries(cols.map((c) => [c.fieldKey, c]));
    expect(byKey.id?.dataType).toBe("number");
    expect(byKey.email?.dataType).toBe("string");
    expect(byKey.active?.dataType).toBe("boolean");
    expect(byKey.joined_at?.dataType).toBe("date");
    expect(byKey.tier?.dataType).toBe("enum");
    expect([...(byKey.tier?.enumValues ?? [])].sort()).toEqual(["bronze", "gold", "silver"]);

    const batch = await db.prisma.sourceBatch.findUnique({
      where: { id: batchId },
    });
    expect(batch?.status).toBe("parsed");
    expect(batch?.rowCount).toBe(5000);
    expect(batch?.finishedAt).toBeTruthy();

    // Progress ticks: every 1000 rows + a final flush at the total.
    expect(progressTicks.length).toBeGreaterThanOrEqual(5);
    expect(progressTicks[progressTicks.length - 1]).toBe(5000);
  });
});
