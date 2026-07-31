/**
 * Source Ingestion module — blueprint Module 4. Upload lifecycle
 * (presign → complete), source/batch reads. Presigned PUT to S3/MinIO; the
 * API only stores metadata and HEAD-verifies the object on complete.
 */
import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { IngestionDTO, SourceType, TenantContext } from "@pintle/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { EventBus } from "../common/event-bus.js";
import { IdempotencyService } from "../common/idempotency.service.js";
import { PrismaService } from "../common/prisma.service.js";
import { StorageService } from "../common/storage.service.js";
import { UploadQueue } from "../common/upload-queue.js";

const PRESIGN_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_MAX_UPLOAD_BYTES = Number(
  process.env.UPLOAD_MAX_BYTES ?? 1_073_741_824, // 1 GiB
);
const PRESIGN_ENDPOINT = "uploads/presign";

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly storage: StorageService,
    private readonly queue: UploadQueue,
    private readonly idempotency: IdempotencyService,
    @InjectPinoLogger(IngestionService.name)
    private readonly logger: PinoLogger,
  ) {}

  private async requireProject(projectId: string) {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");
    return project;
  }

  /** Per-tenant upload size limit from feature_entitlements, else default. */
  private async maxUploadBytes(): Promise<number> {
    const ent = await this.prisma.tenant.featureEntitlement.findFirst({
      where: { featureKey: "upload_quota", enabled: true },
    });
    const cfg = ent?.config as { maxBytes?: number } | null;
    return typeof cfg?.maxBytes === "number" ? cfg.maxBytes : DEFAULT_MAX_UPLOAD_BYTES;
  }

  /** POST /v1/projects/:projectId/uploads/presign */
  async presign(
    ctx: TenantContext,
    projectId: string,
    dto: IngestionDTO.PresignUploadRequest,
    idempotencyKey: string | undefined,
    requestId: string,
  ): Promise<IngestionDTO.PresignUploadResponse> {
    await this.requireProject(projectId);

    if (idempotencyKey) {
      const cached = await this.idempotency.get<IngestionDTO.PresignUploadResponse>(
        ctx.tenantId,
        idempotencyKey,
        PRESIGN_ENDPOINT,
      );
      if (cached) {
        this.logger.info(
          { tenantId: ctx.tenantId, projectId, idempotencyKey },
          "presign idempotent replay",
        );
        return cached;
      }
    }

    const max = await this.maxUploadBytes();
    if (dto.sizeBytes > max) {
      throw new ApiException(
        "VALIDATION_FAILED",
        `File exceeds the tenant upload quota (${max} bytes)`,
        [{ field: "sizeBytes", issue: `must be <= ${max}` }],
      );
    }

    const uploadId = randomUUID();
    const objectKey = this.storage.objectKey(ctx.tenantId, projectId, uploadId, dto.fileName);

    const dataSource = await this.prisma.tenant.dataSource.create({
      data: {
        tenantId: ctx.tenantId,
        projectId,
        sourceType: dto.sourceType,
        name: dto.fileName,
        status: "connected",
      },
    });

    await this.prisma.tenant.sourceUpload.create({
      data: {
        id: uploadId,
        tenantId: ctx.tenantId,
        projectId,
        dataSourceId: dataSource.id,
        objectKey,
        originalFilename: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: BigInt(dto.sizeBytes),
        checksumSha256: "",
        uploadStatus: "pending",
        uploadedBy: ctx.userId,
      },
    });

    const uploadUrl = await this.storage.presignPut(objectKey, dto.mimeType, PRESIGN_TTL_SECONDS);

    const response: IngestionDTO.PresignUploadResponse = {
      uploadId,
      objectKey,
      uploadUrl,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    };

    await this.events.publish({
      name: "source.upload.registered",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { uploadId, projectId, dataSourceId: dataSource.id },
    });

    if (idempotencyKey) {
      await this.idempotency.save(ctx.tenantId, idempotencyKey, PRESIGN_ENDPOINT, response);
    }

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, uploadId },
      "upload presigned",
    );
    return response;
  }

  /** POST /v1/projects/:projectId/uploads/complete */
  async complete(
    ctx: TenantContext,
    projectId: string,
    dto: IngestionDTO.CompleteUploadRequest,
    requestId: string,
  ): Promise<{ batchId: string }> {
    const upload = await this.prisma.tenant.sourceUpload.findUnique({
      where: { id: dto.uploadId },
    });
    if (!upload || upload.projectId !== projectId) {
      throw ApiException.notFound("Upload not found");
    }

    const exists = await this.storage.objectExists(upload.objectKey);
    if (!exists) {
      throw new ApiException(
        "CONFLICT",
        "Object not found in storage — PUT the file before completing",
      );
    }

    const dataSource = await this.prisma.tenant.dataSource.findUnique({
      where: { id: upload.dataSourceId },
    });

    const batch = await this.prisma.tenant.$transaction(async (tx) => {
      await tx.sourceUpload.update({
        where: { id: upload.id },
        data: {
          uploadStatus: "uploaded",
          checksumSha256: dto.checksumSha256,
          uploadedAt: new Date(),
        },
      });
      await tx.dataSource.update({
        where: { id: upload.dataSourceId },
        data: { status: "uploaded" },
      });
      return tx.sourceBatch.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          dataSourceId: upload.dataSourceId,
          sourceUploadId: upload.id,
          batchType: "initial",
          status: "queued",
        },
      });
    });

    // EXACT blueprint queue contract.
    await this.queue.enqueue({
      tenantId: ctx.tenantId,
      projectId,
      batchId: batch.id,
      uploadId: upload.id,
      objectKey: upload.objectKey,
      sourceType: (dataSource?.sourceType ?? "csv") as SourceType,
    });

    const occurredAt = new Date().toISOString();
    await this.events.publish({
      name: "source.upload.completed",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt,
      payload: { uploadId: upload.id, projectId },
    });
    await this.events.publish({
      name: "source.batch.created",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt,
      payload: { batchId: batch.id, projectId, status: "queued" },
    });

    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        uploadId: upload.id,
        batchId: batch.id,
      },
      "upload completed, batch queued",
    );
    return { batchId: batch.id };
  }

  /** GET /v1/projects/:projectId/sources */
  async listSources(
    ctx: TenantContext,
    projectId: string,
  ): Promise<IngestionDTO.ListSourcesResponse> {
    await this.requireProject(projectId);
    const sources = await this.prisma.tenant.dataSource.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    const summaries = await Promise.all(
      sources.map(async (s) => {
        const latest = await this.prisma.tenant.sourceBatch.findFirst({
          where: { dataSourceId: s.id },
          orderBy: { createdAt: "desc" },
        });
        return {
          id: s.id,
          name: s.name,
          sourceType: s.sourceType as SourceType,
          status: s.status as IngestionDTO.ListSourcesResponse["sources"][number]["status"],
          latestBatchStatus:
            (latest?.status as IngestionDTO.SourceBatch["status"] | undefined) ?? null,
        };
      }),
    );

    this.logger.info({ tenantId: ctx.tenantId, userId: ctx.userId, projectId }, "sources listed");
    return { sources: summaries };
  }

  /** GET /v1/source-batches/:batchId */
  async getBatch(ctx: TenantContext, batchId: string): Promise<IngestionDTO.SourceBatch> {
    const batch = await this.prisma.tenant.sourceBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw ApiException.notFound("Batch not found");

    const snapshot = await this.prisma.tenant.sourceSchemaSnapshot.findFirst({
      where: { batchId },
      orderBy: { createdAt: "desc" },
    });

    this.logger.info({ tenantId: ctx.tenantId, userId: ctx.userId, batchId }, "batch read");
    return {
      id: batch.id,
      status: batch.status as IngestionDTO.SourceBatch["status"],
      rowCount: batch.rowCount,
      startedAt: batch.startedAt ? batch.startedAt.toISOString() : null,
      finishedAt: batch.finishedAt ? batch.finishedAt.toISOString() : null,
      sourceSnapshotId: snapshot?.id ?? null,
    };
  }

  /** Current batch status (for the SSE snapshot frame). */
  async batchStatus(batchId: string): Promise<{ batchId: string; status: string } | null> {
    const batch = await this.prisma.tenant.sourceBatch.findUnique({
      where: { id: batchId },
    });
    return batch ? { batchId: batch.id, status: batch.status } : null;
  }
}
