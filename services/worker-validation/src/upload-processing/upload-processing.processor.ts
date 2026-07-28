/**
 * `upload-processing` BullMQ worker. The parse half of LLD §7 — Validation
 * (Module 7): download → format-detect → stream-parse CSV → infer schema →
 * persist snapshot + batch row count → emit events.
 *
 * Failures use BullMQ's `UnrecoverableError` so a determinate file problem
 * (bad format, malformed CSV) doesn't burn three retries before going to the
 * DLQ; transient errors (S3 fetch, DB) propagate normally and use the
 * backoff/retry policy in `createBaseWorker`.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { GetObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import {
  UPLOAD_PROCESSING_QUEUE,
  UploadProcessingJobSchema,
  type UploadProcessingJob,
  type UploadProcessingResult,
} from "@pintle/contracts";
import { prisma, prismaForTenant } from "@pintle/db";
import {
  createBaseWorker,
  redisConnection,
  type JobContext,
  type WorkerHandle,
} from "@pintle/services-common";
import { UnrecoverableError } from "bullmq";
import { parse as csvParse } from "csv-parse";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { detectFormat } from "./format-detect.js";
import { inferSchema, SCHEMA_INFERENCE_SAMPLE_LIMIT } from "./schema-inference.js";

const PROGRESS_EVERY = 1000;

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

@Injectable()
export class UploadProcessingProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private handle: WorkerHandle<UploadProcessingJob, UploadProcessingResult> | null = null;
  private readonly bucket = process.env.S3_BUCKET ?? "migration-tower";
  private readonly s3 = s3Client();

  constructor(
    @InjectPinoLogger(UploadProcessingProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.handle = createBaseWorker<UploadProcessingJob, UploadProcessingResult>({
      queue: UPLOAD_PROCESSING_QUEUE,
      connection: redisConnection(),
      process: (ctx) => this.handle$process(ctx),
    });
    this.logger.info({ queue: UPLOAD_PROCESSING_QUEUE }, "upload-processing worker attached");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle?.close();
  }

  /** Exposed for tests — direct invocation without BullMQ. */
  async runDirect(
    job: UploadProcessingJob,
    progress: (rowsDone: number) => Promise<void> = async () => {},
  ): Promise<UploadProcessingResult> {
    const ctx: JobContext<UploadProcessingJob> = {
      job: { data: job, id: job.batchId } as never,
      progress: async (rowsDone) => progress(rowsDone),
    };
    return this.handle$process(ctx);
  }

  private async handle$process(
    ctx: JobContext<UploadProcessingJob>,
  ): Promise<UploadProcessingResult> {
    const parsed = UploadProcessingJobSchema.parse(ctx.job.data);
    const { tenantId, projectId, batchId, uploadId, objectKey } = parsed;
    const log = this.logger;
    const scoped = prismaForTenant(tenantId);

    log.info({ tenantId, projectId, batchId }, "parse start");
    await scoped.sourceBatch.update({
      where: { id: batchId },
      data: { status: "parsing", startedAt: new Date() },
    });

    const upload = await scoped.sourceUpload.findUnique({
      where: { id: uploadId },
    });
    if (!upload) {
      throw new UnrecoverableError(`upload ${uploadId} not found`);
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-upload-"));
    const tmpFile = path.join(tmpDir, path.basename(upload.originalFilename));

    try {
      // 1. Stream S3 object → temp file (never load whole file in memory).
      const obj: GetObjectCommandOutput = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const body = obj.Body as Readable | undefined;
      if (!body) throw new UnrecoverableError("S3 object body was empty");
      await pipeline(body, createWriteStream(tmpFile));

      // 2. Detect format.
      const format = await detectFormat(tmpFile, upload.originalFilename, upload.mimeType);
      if (format !== "csv") {
        throw new UnrecoverableError(
          `unsupported format "${format ?? "unknown"}" — only csv is parsed in this module`,
        );
      }

      // 3. Stream-parse CSV (sample first 100 rows; count + progress for the rest).
      const parser = createReadStream(tmpFile).pipe(
        csvParse({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_quotes: true,
          relax_column_count: true,
        }),
      );
      const sampleRows: Record<string, string>[] = [];
      let headers: string[] = [];
      let rowCount = 0;
      for await (const record of parser as AsyncIterable<Record<string, string>>) {
        if (rowCount === 0) headers = Object.keys(record);
        if (sampleRows.length < SCHEMA_INFERENCE_SAMPLE_LIMIT) {
          sampleRows.push(record);
        }
        rowCount++;
        if (rowCount % PROGRESS_EVERY === 0) await ctx.progress(rowCount);
      }
      await ctx.progress(rowCount);

      // 4. Infer schema.
      const columns = inferSchema(headers, sampleRows);

      // 5. Persist snapshot + finalise batch atomically. version = max + 1
      //    per project — read inside the transaction so concurrent batches
      //    don't collide.
      const { snapshotId } = await prisma.$transaction(async (tx) => {
        const latest = await tx.sourceSchemaSnapshot.findFirst({
          where: { tenantId, projectId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const snapshot = await tx.sourceSchemaSnapshot.create({
          data: {
            tenantId,
            projectId,
            batchId,
            version: (latest?.version ?? 0) + 1,
            detectedFormat: "csv",
            headerRowIndex: 0,
            rowSampleCount: sampleRows.length,
            // Prisma's InputJsonValue is too narrow for our InferredColumn[]
            // (optional fields). Round-trip via JSON to satisfy the type.
            schemaJson: JSON.parse(JSON.stringify({ columns })),
          },
        });
        await tx.sourceBatch.update({
          where: { id: batchId },
          data: {
            status: "parsed",
            rowCount,
            finishedAt: new Date(),
          },
        });
        return { snapshotId: snapshot.id };
      });

      log.info(
        { tenantId, projectId, batchId, rowCount, columns: columns.length, snapshotId },
        "parse complete",
      );
      return { snapshotId, rowCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ tenantId, projectId, batchId, err: message }, "parse failed");
      try {
        await prisma.$transaction(async (tx) => {
          await tx.sourceBatch.update({
            where: { id: batchId },
            data: { status: "failed", finishedAt: new Date() },
          });
          // Record the error on a snapshot row (detection_warnings JSONB) so
          // the failure travels with the project's history.
          await tx.sourceSchemaSnapshot.create({
            data: {
              tenantId,
              projectId,
              batchId,
              version: -1, // sentinel for failed-parse snapshots; not unique-checked.
              detectedFormat: "csv",
              headerRowIndex: 0,
              rowSampleCount: 0,
              schemaJson: {},
              detectionWarnings: { error: message },
            },
          });
        });
      } catch (writeErr) {
        log.error({ writeErr }, "failure-path DB writes failed");
      }
      throw err instanceof UnrecoverableError ? err : new UnrecoverableError(message);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
