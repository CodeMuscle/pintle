/**
 * `upload-processing` BullMQ producer. Job data matches the blueprint's
 * Module-4 queue contract EXACTLY:
 *   { tenantId, projectId, batchId, uploadId, objectKey, sourceType }
 * The job id is derived from batchId so re-enqueuing the same batch is
 * idempotent (CLAUDE.md → Coding conventions §4).
 */
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { UPLOAD_PROCESSING_QUEUE, type UploadProcessingJob } from "@pintle/contracts";
import { DEFAULT_JOB_OPTIONS, redisConnection } from "@pintle/services-common";
import { Queue } from "bullmq";

export { UPLOAD_PROCESSING_QUEUE, type UploadProcessingJob };

@Injectable()
export class UploadQueue implements OnModuleDestroy {
  private readonly logger = new Logger(UploadQueue.name);
  private readonly queue = new Queue<UploadProcessingJob>(UPLOAD_PROCESSING_QUEUE, {
    connection: redisConnection(),
  });

  async enqueue(job: UploadProcessingJob): Promise<void> {
    await this.queue.add(UPLOAD_PROCESSING_QUEUE, job, {
      // BullMQ forbids ':' in custom job ids.
      jobId: `${UPLOAD_PROCESSING_QUEUE}-${job.batchId}`,
      ...DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(
      { batchId: job.batchId, tenantId: job.tenantId },
      "enqueued upload-processing job",
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
