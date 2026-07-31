/**
 * Issue Management (LLD §8 — partial). PATCH a single issue's status +
 * resolution note, or bulk-resolve a filtered set. The list endpoint lives
 * on the validation module (project-scoped issues feed).
 */
import { Injectable } from "@nestjs/common";
import type {
  IssueSeverity,
  IssueStatus,
  TenantContext,
  ValidationDTO,
  ValidationRuleKey,
} from "@pintle/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    @InjectPinoLogger(IssuesService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** PATCH /v1/issues/:id */
  async patch(
    ctx: TenantContext,
    issueId: string,
    dto: ValidationDTO.PatchIssueRequest,
    requestId: string,
  ): Promise<ValidationDTO.ValidationIssue> {
    const issue = await this.prisma.tenant.validationIssue.findUnique({
      where: { id: issueId },
    });
    if (!issue) throw ApiException.notFound("Issue not found");

    const now = new Date();
    const updated = await this.prisma.tenant.validationIssue.update({
      where: { id: issueId },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote ?? null,
        resolvedAt: now,
        resolvedBy: ctx.userId,
      },
    });

    await this.events.publish({
      name: dto.status === "resolved" ? "issue.resolved" : "issue.ignored",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: now.toISOString(),
      payload: {
        issueId,
        runId: updated.runId,
        destinationFieldKey: updated.destinationFieldKey,
      },
    });
    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        issueId,
        status: dto.status,
      },
      "issue status changed",
    );

    return this.toDto(updated);
  }

  /** POST /v1/issues/bulk-resolve */
  async bulkResolve(
    ctx: TenantContext,
    dto: ValidationDTO.BulkResolveRequest,
    requestId: string,
  ): Promise<ValidationDTO.BulkResolveResponse> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: dto.filter.projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");

    const where: Record<string, unknown> = {
      projectId: dto.filter.projectId,
      status: "open",
    };
    if (dto.filter.runId) where.runId = dto.filter.runId;
    if (dto.filter.destinationFieldKey) where.destinationFieldKey = dto.filter.destinationFieldKey;
    if (dto.filter.ruleKey) where.ruleKey = dto.filter.ruleKey;
    if (dto.filter.severity) where.severity = dto.filter.severity;

    const now = new Date();
    const { count } = await this.prisma.tenant.validationIssue.updateMany({
      where,
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote ?? null,
        resolvedAt: now,
        resolvedBy: ctx.userId,
      },
    });

    await this.events.publish({
      name: dto.status === "resolved" ? "issue.resolved" : "issue.ignored",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: now.toISOString(),
      payload: { bulk: true, count, filter: dto.filter },
    });
    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId: dto.filter.projectId,
        count,
        status: dto.status,
      },
      "issues bulk-resolved",
    );

    return { updated: count };
  }

  private toDto(
    i: Awaited<ReturnType<PrismaService["tenant"]["validationIssue"]["findUnique"]>> & object,
  ): ValidationDTO.ValidationIssue {
    return {
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
    };
  }
}
