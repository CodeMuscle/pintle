/**
 * Migration Projects module — blueprint Module 3. Lifecycle, cursor-paginated
 * listing, detail+summary, server-enforced stage machine, activity feed.
 * Every query is tenant-scoped (cross-tenant access → not found → 404).
 */
import { Injectable } from "@nestjs/common";
import type { ProjectsDTO, ProjectStage, ProjectStatus, TenantContext } from "@pintle/contracts";
import { Prisma, PrismaClientKnownRequestError } from "@pintle/db";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { keysetPage } from "../common/cursor.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";

import { planStageTransition } from "./stage-machine.js";

type ProjectRow = {
  id: string;
  name: string;
  customerName: string;
  projectCode: string;
  status: string;
  currentStage: string;
  migrationType: string;
  targetEnvironment: string;
  targetProductType: string;
  ownerUserId: string;
  dueAt: Date | null;
  wentLiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toProject(p: ProjectRow): ProjectsDTO.Project {
  return {
    id: p.id,
    name: p.name,
    customerName: p.customerName,
    projectCode: p.projectCode,
    status: p.status as ProjectStatus,
    currentStage: p.currentStage as ProjectStage,
    migrationType: p.migrationType as ProjectsDTO.Project["migrationType"],
    targetEnvironment: p.targetEnvironment as ProjectsDTO.Project["targetEnvironment"],
    targetProductType: p.targetProductType,
    ownerUserId: p.ownerUserId,
    dueAt: p.dueAt ? p.dueAt.toISOString() : null,
    wentLiveAt: p.wentLiveAt ? p.wentLiveAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    @InjectPinoLogger(ProjectsService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** POST /v1/migration-projects — project_code unique per tenant. */
  async create(
    ctx: TenantContext,
    dto: ProjectsDTO.CreateProjectRequest,
    requestId: string,
  ): Promise<ProjectsDTO.Project> {
    try {
      const project = await this.prisma.tenant.migrationProject.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          customerName: dto.customerName,
          projectCode: dto.projectCode,
          status: "draft",
          currentStage: "setup",
          migrationType: dto.migrationType,
          targetEnvironment: dto.targetEnvironment,
          targetProductType: dto.targetProductType,
          ownerUserId: dto.ownerUserId,
        },
      });

      await this.prisma.tenant.projectActivity.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: project.id,
          actorUserId: ctx.userId,
          activityType: "project.created",
          payload: { projectCode: project.projectCode },
        },
      });

      await this.events.publish({
        name: "migration_project.created",
        tenantId: ctx.tenantId,
        requestId,
        occurredAt: new Date().toISOString(),
        payload: { projectId: project.id, projectCode: project.projectCode },
      });
      this.logger.info(
        { tenantId: ctx.tenantId, userId: ctx.userId, projectId: project.id },
        "project created",
      );
      return toProject(project);
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ApiException(
          "CONFLICT",
          `projectCode "${dto.projectCode}" already exists for this tenant`,
          [{ field: "projectCode", issue: "must be unique per tenant" }],
        );
      }
      throw err;
    }
  }

  /** GET /v1/migration-projects — filtered + keyset (cursor) pagination. */
  async list(
    ctx: TenantContext,
    q: ProjectsDTO.ListProjectsQuery,
  ): Promise<ProjectsDTO.ListProjectsResponse> {
    const filters: Prisma.MigrationProjectWhereInput[] = [];
    if (q.status) filters.push({ status: q.status });
    if (q.stage) filters.push({ currentStage: q.stage });
    if (q.ownerUserId) filters.push({ ownerUserId: q.ownerUserId });
    if (q.search) {
      filters.push({
        OR: [
          { name: { contains: q.search, mode: "insensitive" } },
          { customerName: { contains: q.search, mode: "insensitive" } },
          { projectCode: { contains: q.search, mode: "insensitive" } },
        ],
      });
    }

    const { items, nextCursor } = await keysetPage(q.cursor, q.limit, (after, take) => {
      const where: Prisma.MigrationProjectWhereInput = {
        AND: [
          ...filters,
          ...(after
            ? [
                {
                  OR: [
                    { createdAt: { lt: after.createdAt } },
                    {
                      createdAt: after.createdAt,
                      id: { lt: after.id },
                    },
                  ],
                } satisfies Prisma.MigrationProjectWhereInput,
              ]
            : []),
        ],
      };
      return this.prisma.tenant.migrationProject.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    });

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, count: items.length },
      "projects listed",
    );
    return { items: items.map(toProject), nextCursor };
  }

  private async requireProject(projectId: string): Promise<ProjectRow> {
    const project = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!project) throw ApiException.notFound("Project not found");
    return project;
  }

  /** GET /v1/migration-projects/:projectId — project + activity + summary. */
  async get(ctx: TenantContext, projectId: string): Promise<ProjectsDTO.ProjectDetailResponse> {
    const project = await this.requireProject(projectId);

    const [recentActivity, lastBatch] = await Promise.all([
      this.prisma.tenant.projectActivity.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
      this.prisma.tenant.sourceBatch.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId },
      "project detail read",
    );
    return {
      project: toProject(project),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        activityType: a.activityType,
        actorUserId: a.actorUserId,
        payload: a.payload,
        createdAt: a.createdAt.toISOString(),
      })),
      summary: {
        // Issues are Module 8 (not yet in schema) — 0 until then.
        openIssuesCount: 0,
        lastBatchStatus:
          (lastBatch?.status as ProjectsDTO.ProjectSummary["lastBatchStatus"]) ?? null,
      },
    };
  }

  /** POST /v1/migration-projects/:projectId/advance-stage — state machine. */
  async advanceStage(
    ctx: TenantContext,
    projectId: string,
    dto: ProjectsDTO.AdvanceStageRequest,
    requestId: string,
  ): Promise<ProjectsDTO.AdvanceStageResponse> {
    const project = await this.requireProject(projectId);

    const plan = planStageTransition(
      {
        stage: project.currentStage as ProjectStage,
        status: project.status as ProjectStatus,
      },
      dto.toStage,
    );
    if (!plan.ok) {
      throw new ApiException("CONFLICT", plan.reason, [{ field: "toStage", issue: plan.reason }]);
    }

    // Interactive tx (not the array form): client-extension operations don't
    // return PrismaPromise, so the array overload can't be used.
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.migrationProject.update({
        where: { id: projectId },
        data: { status: plan.toStatus, currentStage: plan.toStage },
      });
      await tx.migrationStageHistory.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          fromStage: project.currentStage,
          toStage: plan.toStage,
          changedBy: ctx.userId,
          reason: dto.reason ?? null,
        },
      });
      await tx.projectActivity.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          actorUserId: ctx.userId,
          activityType: plan.event,
          payload: {
            from: project.currentStage,
            to: plan.toStage,
            status: plan.toStatus,
            reason: dto.reason ?? null,
          },
        },
      });
    });

    await this.events.publish({
      name: plan.event,
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: {
        projectId,
        from: project.currentStage,
        to: plan.toStage,
        status: plan.toStatus,
      },
    });
    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        from: project.currentStage,
        to: plan.toStage,
      },
      "project stage advanced",
    );

    return { status: plan.toStatus, currentStage: plan.toStage };
  }

  /** GET /v1/migration-projects/:projectId/activity — cursor paginated. */
  async activity(
    ctx: TenantContext,
    projectId: string,
    q: ProjectsDTO.ListActivityQuery,
  ): Promise<ProjectsDTO.ListActivityResponse> {
    await this.requireProject(projectId);

    const { items, nextCursor } = await keysetPage(q.cursor, q.limit, (after, take) =>
      this.prisma.tenant.projectActivity.findMany({
        where: after
          ? {
              projectId,
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : { projectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      }),
    );

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId },
      "project activity listed",
    );
    return {
      items: items.map((a) => ({
        id: a.id,
        activityType: a.activityType,
        actorUserId: a.actorUserId,
        payload: a.payload,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** POST /v1/migration-projects/:projectId/members */
  async addMember(
    ctx: TenantContext,
    projectId: string,
    dto: ProjectsDTO.AddProjectMemberRequest,
  ): Promise<ProjectsDTO.ProjectMember> {
    await this.requireProject(projectId);

    const member = await this.prisma.tenant.projectMember.upsert({
      where: {
        tenantId_projectId_userId: {
          tenantId: ctx.tenantId,
          projectId,
          userId: dto.userId,
        },
      },
      update: { accessLevel: dto.accessLevel },
      create: {
        tenantId: ctx.tenantId,
        projectId,
        userId: dto.userId,
        accessLevel: dto.accessLevel,
      },
    });

    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        memberUserId: dto.userId,
      },
      "project member added",
    );
    return {
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      accessLevel: member.accessLevel as ProjectsDTO.ProjectMember["accessLevel"],
      createdAt: member.createdAt.toISOString(),
    };
  }

  /** DELETE /v1/migration-projects/:projectId/members/:memberId */
  async removeMember(
    ctx: TenantContext,
    projectId: string,
    memberId: string,
  ): Promise<{ removed: true }> {
    await this.requireProject(projectId);

    const { count } = await this.prisma.tenant.projectMember.deleteMany({
      where: { id: memberId, projectId },
    });
    if (count === 0) throw ApiException.notFound("Project member not found");

    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, memberId },
      "project member removed",
    );
    return { removed: true };
  }
}
