/** Mapping endpoints — blueprint Module 6 API surface. */
import { Body, Controller, Get, Headers, Param, Post, Put, Query, Req } from "@nestjs/common";
import { MappingDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { MappingService } from "./mapping.service.js";

@Controller("v1/projects/:projectId/mappings")
export class MappingController {
  constructor(private readonly mapping: MappingService) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Get()
  getMappings(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
  ): Promise<MappingDTO.GetMappingsResponse> {
    return this.mapping.getMappings(this.ctxOrThrow(ctx), projectId);
  }

  @Put()
  upsertMappings(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(MappingDTO.UpsertMappingsRequestSchema))
    dto: MappingDTO.UpsertMappingsRequest,
    @Req() req: unknown,
  ): Promise<MappingDTO.UpsertMappingsResponse> {
    return this.mapping.upsertMappings(this.ctxOrThrow(ctx), projectId, dto, requestIdOf(req));
  }

  @Post("publish")
  publish(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodValidationPipe(MappingDTO.PublishMappingRequestSchema))
    dto: MappingDTO.PublishMappingRequest,
    @Req() req: unknown,
  ): Promise<MappingDTO.PublishMappingResponse> {
    return this.mapping.publish(this.ctxOrThrow(ctx), projectId, ifMatch, dto, requestIdOf(req));
  }

  @Get("versions")
  listVersions(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(MappingDTO.ListMappingVersionsQuerySchema))
    q: MappingDTO.ListMappingVersionsQuery,
  ): Promise<MappingDTO.ListMappingVersionsResponse> {
    return this.mapping.listVersions(this.ctxOrThrow(ctx), projectId, q);
  }

  @Get("diff")
  diffVersions(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(MappingDTO.MappingDiffQuerySchema))
    q: MappingDTO.MappingDiffQuery,
  ): Promise<MappingDTO.MappingDiffResponse> {
    return this.mapping.diffVersions(this.ctxOrThrow(ctx), projectId, q);
  }
}
