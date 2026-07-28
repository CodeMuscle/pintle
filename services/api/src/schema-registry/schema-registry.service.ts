/**
 * Schema Registry — blueprint Module 5. Source-schema snapshots (latest per
 * project, re-parseable on demand) + the destination schemas the product
 * model exposes (per-tenant override, global fallback).
 */
import { Injectable } from "@nestjs/common";
import type {
  DetectedFormat,
  DestinationSchemaStatus,
  SchemaRegistryDTO,
  SourceType,
  TenantContext,
} from "@pintle/contracts";
import { prisma as basePrisma } from "@pintle/db";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";
import { UploadQueue } from "../common/upload-queue.js";

@Injectable()
export class SchemaRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly uploadQueue: UploadQueue,
    @InjectPinoLogger(SchemaRegistryService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** GET /v1/projects/:projectId/source-schema — the latest valid snapshot. */
  async getSourceSchema(
    ctx: TenantContext,
    projectId: string,
  ): Promise<SchemaRegistryDTO.SourceSchemaSnapshotResponse> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");

    // Skip the version=-1 sentinel rows the parse worker writes on failure.
    const snap = await this.prisma.tenant.sourceSchemaSnapshot.findFirst({
      where: { projectId, version: { gte: 1 } },
      orderBy: { version: "desc" },
    });
    if (!snap) {
      throw ApiException.notFound(
        "No source-schema snapshot for this project yet — upload + complete a file first",
      );
    }

    const columns = ((snap.schemaJson as { columns?: unknown[] } | null)?.columns ??
      []) as SchemaRegistryDTO.SourceSchemaSnapshotResponse["columns"];

    this.logger.info(
      { tenantId: ctx.tenantId, projectId, snapshotId: snap.id },
      "source schema read",
    );
    return {
      snapshotId: snap.id,
      version: snap.version,
      detectedFormat: snap.detectedFormat as DetectedFormat,
      columns,
    };
  }

  /**
   * GET /v1/destination-schemas/:productType/active.
   * Tenant-scoped row wins over the global (tenantId IS NULL) fallback.
   * We use the base prisma (not the tenant-scoped client) so the global row
   * is visible.
   */
  async getActiveDestinationSchema(
    ctx: TenantContext,
    productType: string,
  ): Promise<SchemaRegistryDTO.DestinationSchemaResponse> {
    const schema = await basePrisma.destinationSchema.findFirst({
      where: {
        productType,
        status: "active",
        OR: [{ tenantId: ctx.tenantId }, { tenantId: null }],
      },
      // tenantId NULLs sort last in DESC — tenant-specific wins.
      orderBy: [{ tenantId: "desc" }, { version: "desc" }],
    });
    if (!schema) {
      throw ApiException.notFound(`No active destination schema for productType="${productType}"`);
    }

    this.logger.info(
      { tenantId: ctx.tenantId, productType, schemaId: schema.id },
      "destination schema read",
    );
    return {
      id: schema.id,
      productType: schema.productType,
      version: schema.version,
      status: schema.status as DestinationSchemaStatus,
      schemaJson: schema.schemaJson as Record<string, unknown>,
    };
  }

  /**
   * POST /v1/projects/:projectId/source-schema/refresh.
   * Creates a `retry` batch for the latest upload and enqueues the worker.
   * Idempotent: re-calling for the same upload returns the same batchId
   * because we look up an existing in-flight `queued/parsing` retry first.
   */
  async refresh(
    ctx: TenantContext,
    projectId: string,
    requestId: string,
  ): Promise<SchemaRegistryDTO.RefreshSourceSchemaResponse> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");

    const upload = await this.prisma.tenant.sourceUpload.findFirst({
      where: { projectId, uploadStatus: "uploaded" },
      orderBy: { uploadedAt: "desc" },
    });
    if (!upload) {
      throw new ApiException("CONFLICT", "No completed upload to refresh — upload a file first");
    }

    const existingRetry = await this.prisma.tenant.sourceBatch.findFirst({
      where: {
        projectId,
        sourceUploadId: upload.id,
        batchType: "retry",
        status: { in: ["queued", "parsing"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const batch =
      existingRetry ??
      (await this.prisma.tenant.sourceBatch.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          dataSourceId: upload.dataSourceId,
          sourceUploadId: upload.id,
          batchType: "retry",
          status: "queued",
        },
      }));

    const dataSource = await this.prisma.tenant.dataSource.findUnique({
      where: { id: upload.dataSourceId },
    });

    await this.uploadQueue.enqueue({
      tenantId: ctx.tenantId,
      projectId,
      batchId: batch.id,
      uploadId: upload.id,
      objectKey: upload.objectKey,
      sourceType: (dataSource?.sourceType ?? "csv") as SourceType,
    });

    await this.events.publish({
      name: "schema.source_snapshot.refreshed",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { projectId, batchId: batch.id, uploadId: upload.id },
    });
    this.logger.info(
      { tenantId: ctx.tenantId, projectId, batchId: batch.id, uploadId: upload.id },
      "source-schema refresh enqueued",
    );

    return { batchId: batch.id, status: "queued" };
  }
}
