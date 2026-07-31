/** Migration Projects endpoints — blueprint Module 3 API surface. */
import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ProjectsDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { ProjectsService } from "./projects.service.js";

@Controller("v1/migration-projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Post()
  create(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Body(new ZodValidationPipe(ProjectsDTO.CreateProjectRequestSchema))
    dto: ProjectsDTO.CreateProjectRequest,
    @Req() req: unknown,
  ): Promise<ProjectsDTO.Project> {
    return this.projects.create(this.ctxOrThrow(ctx), dto, requestIdOf(req));
  }

  @Get()
  list(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Query(new ZodValidationPipe(ProjectsDTO.ListProjectsQuerySchema))
    query: ProjectsDTO.ListProjectsQuery,
  ): Promise<ProjectsDTO.ListProjectsResponse> {
    return this.projects.list(this.ctxOrThrow(ctx), query);
  }

  @Get(":projectId")
  get(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
  ): Promise<ProjectsDTO.ProjectDetailResponse> {
    return this.projects.get(this.ctxOrThrow(ctx), projectId);
  }

  @Post(":projectId/advance-stage")
  advanceStage(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(ProjectsDTO.AdvanceStageRequestSchema))
    dto: ProjectsDTO.AdvanceStageRequest,
    @Req() req: unknown,
  ): Promise<ProjectsDTO.AdvanceStageResponse> {
    return this.projects.advanceStage(this.ctxOrThrow(ctx), projectId, dto, requestIdOf(req));
  }

  @Get(":projectId/activity")
  activity(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(ProjectsDTO.ListActivityQuerySchema))
    query: ProjectsDTO.ListActivityQuery,
  ): Promise<ProjectsDTO.ListActivityResponse> {
    return this.projects.activity(this.ctxOrThrow(ctx), projectId, query);
  }

  @Post(":projectId/members")
  addMember(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(ProjectsDTO.AddProjectMemberRequestSchema))
    dto: ProjectsDTO.AddProjectMemberRequest,
  ): Promise<ProjectsDTO.ProjectMember> {
    return this.projects.addMember(this.ctxOrThrow(ctx), projectId, dto);
  }

  @Delete(":projectId/members/:memberId")
  removeMember(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ): Promise<{ removed: true }> {
    return this.projects.removeMember(this.ctxOrThrow(ctx), projectId, memberId);
  }
}
