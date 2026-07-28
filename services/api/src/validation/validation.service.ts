/**
 * Validation — blueprint Module 7 / LLD §7. The API side: creates the run
 * row, hands off the blueprint's "Validation-ready handoff contract" to the
 * `validation` queue, and serves run/summary/listing reads. The actual rule
 * engine runs in `services/worker-validation`.
 */
import { Injectable } from "@nestjs/common";
import type {
  IssueSeverity,
  IssueStatus,
  TenantContext,
  ValidationDTO,
  ValidationRuleKey,
  ValidationRunStatus,
} from "@pintle/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { keysetPage } from "../common/cursor.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";

import { ValidationQueue } from "./validation-queue.js";

const SUMMARY_SAMPLES_PER_GROUP = 5;

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly queue: ValidationQueue,
    @InjectPinoLogger(ValidationService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** POST /v1/migration-projects/:projectId/validate */
  async createRun(
    ctx: TenantContext,
    projectId: string,
    dto: ValidationDTO.CreateValidationRunRequest,
    requestId: string,
  ): Promise<ValidationDTO.CreateValidationRunResponse> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");

    const batch = await this.prisma.tenant.sourceBatch.findUnique({
      where: { id: dto.batchId },
    });
    if (!batch || batch.projectId !== projectId) {
      throw new ApiException("VALIDATION_FAILED", "batchId does not belong to this project", [
        { field: "batchId", issue: "not found for project" },
      ]);
    }
    const version = await this.prisma.tenant.mappingVersion.findUnique({
      where: { id: dto.mappingVersionId },
    });
    if (!version || version.projectId !== projectId) {
      throw new ApiException(
        "VALIDATION_FAILED",
        "mappingVersionId does not belong to this project",
        [{ field: "mappingVersionId", issue: "not found for project" }],
      );
    }

    const run = await this.prisma.tenant.validationRun.create({
      data: {
        tenantId: ctx.tenantId,
        projectId,
        batchId: dto.batchId,
        mappingVersionId: dto.mappingVersionId,
        sourceSnapshotId: version.sourceSnapshotId,
        destinationSchemaId: version.destinationSchemaId,
        status: "queued",
        triggeredBy: ctx.userId,
      },
    });

    await this.queue.enqueue({
      runId: run.id,
      tenantId: ctx.tenantId,
      projectId,
      batchId: dto.batchId,
      sourceSnapshotId: version.sourceSnapshotId,
      destinationSchemaId: version.destinationSchemaId,
      mappingVersionId: dto.mappingVersionId,
      triggeredBy: ctx.userId,
    });

    await this.events.publish({
      name: "validation.started",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { runId: run.id, projectId, batchId: dto.batchId },
    });
    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, runId: run.id },
      "validation run created",
    );

    return { runId: run.id, status: "queued" };
  }

  private async requireRun(runId: string) {
    const run = await this.prisma.tenant.validationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw ApiException.notFound("Validation run not found");
    return run;
  }

  /** GET /v1/validation-runs/:runId */
  async getRun(_ctx: TenantContext, runId: string): Promise<ValidationDTO.ValidationRun> {
    const r = await this.requireRun(runId);
    return {
      id: r.id,
      status: r.status as ValidationRunStatus,
      rowsScanned: r.rowsScanned,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
      infoCount: r.infoCount,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** GET /v1/validation-runs/:runId/summary — grouped (dest field, rule). */
  async getRunSummary(
    ctx: TenantContext,
    runId: string,
  ): Promise<ValidationDTO.ValidationRunSummaryResponse> {
    const run = await this.requireRun(runId);

    const grouped = await this.prisma.tenant.validationIssue.groupBy({
      by: ["destinationFieldKey", "ruleKey", "severity"],
      where: { runId, status: "open" },
      _count: { _all: true },
    });

    const groups = await Promise.all(
      grouped.map(async (g) => {
        const samples = await this.prisma.tenant.validationIssue.findMany({
          where: {
            runId,
            destinationFieldKey: g.destinationFieldKey,
            ruleKey: g.ruleKey,
            severity: g.severity,
            status: "open",
          },
          orderBy: { rowIndex: "asc" },
          take: SUMMARY_SAMPLES_PER_GROUP,
          select: {
            id: true,
            rowIndex: true,
            sampleValue: true,
            message: true,
          },
        });
        return {
          destinationFieldKey: g.destinationFieldKey,
          ruleKey: g.ruleKey as ValidationRuleKey,
          severity: g.severity as IssueSeverity,
          count: g._count._all,
          samples: samples.map((s) => ({
            issueId: s.id,
            rowIndex: s.rowIndex,
            sampleValue: s.sampleValue,
            message: s.message,
          })),
        };
      }),
    );

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, runId, groups: groups.length },
      "validation summary read",
    );
    return {
      run: await this.getRun(ctx, run.id),
      groups,
    };
  }

  /** GET /v1/migration-projects/:projectId/issues — cursor paginated, filterable. */
  async listIssues(
    ctx: TenantContext,
    projectId: string,
    q: ValidationDTO.ListIssuesQuery,
  ): Promise<ValidationDTO.ListIssuesResponse> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");

    const filters: Record<string, unknown> = { projectId };
    if (q.status) filters.status = q.status;
    if (q.severity) filters.severity = q.severity;
    if (q.destinationFieldKey) filters.destinationFieldKey = q.destinationFieldKey;
    if (q.runId) filters.runId = q.runId;

    const { items, nextCursor } = await keysetPage(q.cursor, q.limit, (after, take) =>
      this.prisma.tenant.validationIssue.findMany({
        where: after
          ? {
              ...filters,
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : filters,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      }),
    );

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, count: items.length },
      "issues listed",
    );
    return {
      items: items.map((i) => ({
        id: i.id,
        runId: i.runId,
        severity: i.severity as IssueSeverity,
        ruleKey: i.ruleKey as ValidationRuleKey,
        rowIndex: i.rowIndex,
        sourceFieldKey: i.sourceFieldKey,
        destinationFieldKey: i.destinationFieldKey,
        message: i.message,
        sampleValue: i.sampleValue,
        status: i.status as IssueStatus,
        resolutionNote: i.resolutionNote,
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        resolvedBy: i.resolvedBy,
        createdAt: i.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }
}
