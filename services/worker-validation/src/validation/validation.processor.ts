/**
 * `validation` BullMQ worker — LLD §7. Streams the source file from S3,
 * applies the published mapping version's transforms, evaluates the v1 rule
 * set per row, and writes issues to `validation_issues` in batches of 1 000
 * (small enough to keep memory flat, large enough to amortise the round-trip).
 *
 * Run lifecycle: queued → running (on first row) → completed | failed.
 * Determinate failures (missing batch / version / S3 object) throw
 * `UnrecoverableError` so they DLQ on the first attempt instead of burning
 * retries.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import {
  VALIDATION_QUEUE,
  ValidationJobSchema,
  type ValidationJob,
  type ValidationResult,
} from "@pintle/contracts";
import { prisma, prismaForTenant } from "@pintle/db";
import {
  createBaseWorker,
  redisConnection,
  type JobContext,
  type WorkerHandle,
} from "@pintle/services-common";
import { createStorage } from "@pintle/storage";
import { UnrecoverableError } from "bullmq";
import { parse as csvParse } from "csv-parse";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  evaluateRow,
  resolveForeignKeyIssues,
  RuleEngineState,
  type IssueSpec,
  type ResolvedMapping,
} from "./rule-engine.js";

const BATCH_FLUSH_EVERY = 1000;

@Injectable()
export class ValidationProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private handle: WorkerHandle<ValidationJob, ValidationResult> | null = null;
  private readonly storage = createStorage();

  constructor(
    @InjectPinoLogger(ValidationProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.handle = createBaseWorker<ValidationJob, ValidationResult>({
      queue: VALIDATION_QUEUE,
      connection: redisConnection(),
      process: (ctx) => this.handle$process(ctx),
    });
    this.logger.info({ queue: VALIDATION_QUEUE }, "validation worker attached");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle?.close();
  }

  /** Direct invocation for tests (skips BullMQ). */
  async runDirect(
    job: ValidationJob,
    progress: (rowsDone: number) => Promise<void> = async () => {},
  ): Promise<ValidationResult> {
    const ctx: JobContext<ValidationJob> = {
      job: { data: job, id: `${VALIDATION_QUEUE}-${job.runId}` } as never,
      progress: async (rows) => progress(rows),
    };
    return this.handle$process(ctx);
  }

  private async handle$process(ctx: JobContext<ValidationJob>): Promise<ValidationResult> {
    const job = ValidationJobSchema.parse(ctx.job.data);
    const scoped = prismaForTenant(job.tenantId);

    this.logger.info(
      { tenantId: job.tenantId, projectId: job.projectId, runId: job.runId },
      "validation run start",
    );

    // 1. Move the run to `running` immediately so the SSE snapshot is fresh.
    await scoped.validationRun.update({
      where: { id: job.runId },
      data: { status: "running", startedAt: new Date() },
    });

    const totals = { errorCount: 0, warningCount: 0, infoCount: 0 };
    let rowsScanned = 0;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-validate-"));

    try {
      // 2. Resolve metadata: mappings (with transform keys + dest field defs)
      //    and the S3 object's location.
      const [version, destSchema, upload, transformRuleRows] = await Promise.all([
        scoped.mappingVersion.findUnique({ where: { id: job.mappingVersionId } }),
        prisma.destinationSchema.findUnique({
          where: { id: job.destinationSchemaId },
        }),
        scoped.sourceUpload.findFirst({
          where: { projectId: job.projectId, uploadStatus: "uploaded" },
          orderBy: { uploadedAt: "desc" },
        }),
        scoped.transformRule.findMany({ where: { projectId: null } }),
      ]);

      if (!version)
        throw new UnrecoverableError(`mapping version ${job.mappingVersionId} not found`);
      if (!destSchema)
        throw new UnrecoverableError(`destination schema ${job.destinationSchemaId} not found`);
      if (!upload) throw new UnrecoverableError(`no completed upload for project ${job.projectId}`);

      const ruleById = new Map(transformRuleRows.map((r) => [r.id, r.ruleKey]));
      const destFields = new Map<
        string,
        { dataType?: string; isRequired?: boolean; enumValues?: string[] }
      >(
        (
          (
            destSchema.schemaJson as {
              fields?: Array<{
                fieldKey: string;
                dataType?: string;
                isRequired?: boolean;
                enumValues?: string[];
              }>;
            } | null
          )?.fields ?? []
        ).map((f) => [f.fieldKey, f]),
      );
      const mappingRecord =
        (version.mappingJson as { mappings?: Array<Record<string, unknown>> } | null)?.mappings ??
        [];
      const mappings: ResolvedMapping[] = mappingRecord.map((m) => {
        const transformRuleId = m.transformRuleId as string | undefined;
        return {
          sourceFieldKey: m.sourceFieldKey as string | undefined,
          destinationFieldKey: m.destinationFieldKey as string,
          mappingType: m.mappingType as ResolvedMapping["mappingType"],
          transformRuleKey: transformRuleId ? ruleById.get(transformRuleId) : undefined,
          isRequiredOverride: (m.isRequiredOverride as boolean | null | undefined) ?? null,
          defaultValue: m.defaultValue,
          config: (m.config as Record<string, unknown> | undefined) ?? undefined,
          destField: destFields.get(m.destinationFieldKey as string) ?? {},
        };
      });

      // 3. Stream object → temp file → csv-parse.
      const tmpFile = path.join(tmpDir, path.basename(upload.originalFilename));
      const body = await this.storage.getStream(upload.objectKey);
      await pipeline(body, createWriteStream(tmpFile));

      const parser = createReadStream(tmpFile).pipe(
        csvParse({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_quotes: true,
          relax_column_count: true,
        }),
      );

      const state = new RuleEngineState();
      let buffer: IssueSpec[] = [];

      const flush = async () => {
        if (buffer.length === 0) return;
        await scoped.validationIssue.createMany({
          data: buffer.map((b) => ({
            tenantId: job.tenantId,
            runId: job.runId,
            projectId: job.projectId,
            batchId: job.batchId,
            severity: b.severity,
            ruleKey: b.ruleKey,
            rowIndex: b.rowIndex,
            sourceFieldKey: b.sourceFieldKey,
            destinationFieldKey: b.destinationFieldKey,
            message: b.message,
            sampleValue: b.sampleValue,
          })),
        });
        for (const b of buffer) {
          if (b.severity === "error") totals.errorCount++;
          else if (b.severity === "warning") totals.warningCount++;
          else totals.infoCount++;
        }
        buffer = [];
      };

      for await (const record of parser as AsyncIterable<Record<string, string>>) {
        rowsScanned++;
        const issues = evaluateRow(mappings, { rowIndex: rowsScanned, row: record }, state);
        if (issues.length > 0) buffer.push(...issues);

        if (rowsScanned % BATCH_FLUSH_EVERY === 0) {
          await flush();
          await scoped.validationRun.update({
            where: { id: job.runId },
            data: {
              rowsScanned,
              errorCount: totals.errorCount,
              warningCount: totals.warningCount,
              infoCount: totals.infoCount,
            },
          });
          await ctx.progress(rowsScanned);
        }
      }
      await flush();

      // 4. Second pass for foreign-key checks (needs the full target sets).
      const fkIssues = resolveForeignKeyIssues(state);
      if (fkIssues.length > 0) {
        buffer = fkIssues;
        await flush();
      }

      // 5. Finalise the run row.
      await scoped.validationRun.update({
        where: { id: job.runId },
        data: {
          status: "completed",
          rowsScanned,
          errorCount: totals.errorCount,
          warningCount: totals.warningCount,
          infoCount: totals.infoCount,
          finishedAt: new Date(),
        },
      });
      await ctx.progress(rowsScanned);

      this.logger.info(
        {
          tenantId: job.tenantId,
          projectId: job.projectId,
          runId: job.runId,
          rowsScanned,
          ...totals,
        },
        "validation run complete",
      );

      return { runId: job.runId, rowsScanned, ...totals };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ runId: job.runId, err: message }, "validation run failed");
      try {
        await scoped.validationRun.update({
          where: { id: job.runId },
          data: {
            status: "failed",
            errorMessage: message,
            finishedAt: new Date(),
          },
        });
      } catch (writeErr) {
        this.logger.error({ writeErr }, "failure-path run update failed");
      }
      throw err instanceof UnrecoverableError ? err : new UnrecoverableError(message);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
