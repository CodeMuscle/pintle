/**
 * `validation` BullMQ producer. Same retry/backoff defaults as the upload
 * queue (services-common's `DEFAULT_JOB_OPTIONS`); jobId = `validation-<runId>`
 * so re-calls dedupe and the API-side `QueueEventsBridge` can extract the
 * runId from the jobId for SSE routing.
 */
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { VALIDATION_QUEUE, type ValidationJob } from "@pintle/contracts";
import { DEFAULT_JOB_OPTIONS, redisConnection } from "@pintle/services-common";
import { Queue } from "bullmq";

export { VALIDATION_QUEUE, type ValidationJob };

@Injectable()
export class ValidationQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ValidationQueue.name);
  private readonly queue = new Queue<ValidationJob>(VALIDATION_QUEUE, {
    connection: redisConnection(),
  });

  async enqueue(job: ValidationJob): Promise<void> {
    await this.queue.add(VALIDATION_QUEUE, job, {
      jobId: `${VALIDATION_QUEUE}-${job.runId}`,
      ...DEFAULT_JOB_OPTIONS,
    });
    this.logger.log({ runId: job.runId, tenantId: job.tenantId }, "enqueued validation job");
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
