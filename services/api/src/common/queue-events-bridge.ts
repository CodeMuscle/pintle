/**
 * Bridge from BullMQ `QueueEvents` (Redis pub/sub) to the in-process
 * `EventBus`. Workers run in separate processes; the API can't see their
 * in-memory events, so we lift BullMQ's queue-events onto our bus, keyed by
 * `batchId` / `runId` so the SSE handlers can filter.
 *
 *   upload-processing.progress   →  source.batch.progress
 *   upload-processing.completed  →  source.batch.parsed + schema.source_snapshot.created
 *   upload-processing.failed     →  source.batch.failed
 *
 *   validation.progress          →  validation.progress
 *   validation.completed         →  validation.completed + issues.generated
 *   validation.failed            →  validation.failed
 */
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import {
  UPLOAD_PROCESSING_QUEUE,
  UploadProcessingResultSchema,
  VALIDATION_QUEUE,
  ValidationResultSchema,
  type DomainEvent,
  type DomainEventName,
} from "@pintle/contracts";
import { redisConnection } from "@pintle/services-common";
import { QueueEvents } from "bullmq";

import { EventBus } from "./event-bus.js";

const UPLOAD_JOB_ID_PREFIX = `${UPLOAD_PROCESSING_QUEUE}-`;
const VALIDATION_JOB_ID_PREFIX = `${VALIDATION_QUEUE}-`;

function idFromJobId(jobId: string | undefined, prefix: string): string | null {
  if (!jobId || !jobId.startsWith(prefix)) return null;
  return jobId.slice(prefix.length);
}

@Injectable()
export class QueueEventsBridge implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueEventsBridge.name);
  private uploadEvents: QueueEvents | null = null;
  private validationEvents: QueueEvents | null = null;

  constructor(private readonly bus: EventBus) {}

  onApplicationBootstrap(): void {
    const connection = redisConnection();

    // ── upload-processing ────────────────────────────────────────────
    this.uploadEvents = new QueueEvents(UPLOAD_PROCESSING_QUEUE, { connection });

    this.uploadEvents.on("progress", ({ jobId, data }) => {
      const batchId = idFromJobId(jobId, UPLOAD_JOB_ID_PREFIX);
      if (!batchId) return;
      void this.publish("source.batch.progress", { batchId, progress: data });
    });

    this.uploadEvents.on("completed", ({ jobId, returnvalue }) => {
      const batchId = idFromJobId(jobId, UPLOAD_JOB_ID_PREFIX);
      if (!batchId) return;
      let snapshotId: string | undefined;
      let rowCount: number | undefined;
      try {
        const result = typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue;
        const ok = UploadProcessingResultSchema.safeParse(result);
        if (ok.success) {
          snapshotId = ok.data.snapshotId;
          rowCount = ok.data.rowCount;
        }
      } catch {
        /* ignore malformed */
      }
      void this.publish("source.batch.parsed", { batchId, snapshotId, rowCount });
      if (snapshotId) {
        void this.publish("schema.source_snapshot.created", { batchId, snapshotId });
      }
    });

    this.uploadEvents.on("failed", ({ jobId, failedReason }) => {
      const batchId = idFromJobId(jobId, UPLOAD_JOB_ID_PREFIX);
      if (!batchId) return;
      void this.publish("source.batch.failed", { batchId, error: failedReason });
    });

    // ── validation ───────────────────────────────────────────────────
    this.validationEvents = new QueueEvents(VALIDATION_QUEUE, { connection });

    this.validationEvents.on("progress", ({ jobId, data }) => {
      const runId = idFromJobId(jobId, VALIDATION_JOB_ID_PREFIX);
      if (!runId) return;
      void this.publish("validation.progress", { runId, progress: data });
    });

    this.validationEvents.on("completed", ({ jobId, returnvalue }) => {
      const runId = idFromJobId(jobId, VALIDATION_JOB_ID_PREFIX);
      if (!runId) return;
      let result: {
        rowsScanned?: number;
        errorCount?: number;
        warningCount?: number;
        infoCount?: number;
      } = {};
      try {
        const parsed = typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue;
        const ok = ValidationResultSchema.safeParse(parsed);
        if (ok.success) result = ok.data;
      } catch {
        /* ignore malformed */
      }
      void this.publish("validation.completed", { runId, ...result });
      void this.publish("issues.generated", {
        runId,
        errorCount: result.errorCount ?? 0,
        warningCount: result.warningCount ?? 0,
        infoCount: result.infoCount ?? 0,
      });
    });

    this.validationEvents.on("failed", ({ jobId, failedReason }) => {
      const runId = idFromJobId(jobId, VALIDATION_JOB_ID_PREFIX);
      if (!runId) return;
      void this.publish("validation.failed", { runId, error: failedReason });
    });

    this.logger.log(`attached to QueueEvents("${UPLOAD_PROCESSING_QUEUE}", "${VALIDATION_QUEUE}")`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.uploadEvents?.close();
    await this.validationEvents?.close();
  }

  private async publish(
    name: Extract<
      DomainEventName,
      | "source.batch.progress"
      | "source.batch.parsed"
      | "source.batch.failed"
      | "schema.source_snapshot.created"
      | "validation.progress"
      | "validation.completed"
      | "validation.failed"
      | "issues.generated"
    >,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: DomainEvent<Record<string, unknown>> = {
      name,
      tenantId: "",
      requestId: "",
      occurredAt: new Date().toISOString(),
      payload,
    };
    await this.bus.publish(event);
  }
}
