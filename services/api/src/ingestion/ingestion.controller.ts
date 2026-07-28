/** Source Ingestion endpoints — blueprint Module 4 API surface. */
import { Body, Controller, Get, Headers, Param, Post, Req, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { IngestionDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";
import { Observable } from "rxjs";

import { ApiException } from "../common/api-exception.js";
import { SkipEnvelope } from "../common/decorators.js";
import { EventBus } from "../common/event-bus.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { IngestionService } from "./ingestion.service.js";

const BATCH_EVENTS = [
  "source.batch.created",
  "source.batch.progress",
  "source.batch.parsed",
  "source.batch.failed",
] as const;

@Controller("v1")
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly events: EventBus,
  ) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Post("projects/:projectId/uploads/presign")
  presign(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(IngestionDTO.PresignUploadRequestSchema))
    dto: IngestionDTO.PresignUploadRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() req: unknown,
  ): Promise<IngestionDTO.PresignUploadResponse> {
    return this.ingestion.presign(
      this.ctxOrThrow(ctx),
      projectId,
      dto,
      idempotencyKey,
      requestIdOf(req),
    );
  }

  @Post("projects/:projectId/uploads/complete")
  complete(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(IngestionDTO.CompleteUploadRequestSchema))
    dto: IngestionDTO.CompleteUploadRequest,
    @Req() req: unknown,
  ): Promise<{ batchId: string }> {
    return this.ingestion.complete(this.ctxOrThrow(ctx), projectId, dto, requestIdOf(req));
  }

  @Get("projects/:projectId/sources")
  listSources(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
  ): Promise<IngestionDTO.ListSourcesResponse> {
    return this.ingestion.listSources(this.ctxOrThrow(ctx), projectId);
  }

  @Get("source-batches/:batchId")
  getBatch(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("batchId") batchId: string,
  ): Promise<IngestionDTO.SourceBatch> {
    return this.ingestion.getBatch(this.ctxOrThrow(ctx), batchId);
  }

  /**
   * Live batch progress. Emits a `snapshot` of the current status on connect
   * (so the queued state is visible even if you connect after `complete`),
   * then streams subsequent batch events for this batchId.
   */
  @Sse("source-batches/:batchId/events")
  @SkipEnvelope()
  async batchEvents(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("batchId") batchId: string,
  ): Promise<Observable<MessageEvent>> {
    this.ctxOrThrow(ctx);
    const snapshot = await this.ingestion.batchStatus(batchId);
    if (!snapshot) throw ApiException.notFound("Batch not found");

    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        type: "snapshot",
        data: { batchId, status: snapshot.status },
      });

      const unsubs = BATCH_EVENTS.map((name) =>
        this.events.subscribe(name, (event) => {
          const payload = event.payload as { batchId?: string };
          if (payload?.batchId === batchId) {
            subscriber.next({
              type: event.name,
              data: { batchId, ...(event.payload as object) },
            });
          }
        }),
      );

      return () => unsubs.forEach((u) => u());
    });
  }
}
