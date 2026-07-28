/** Schema Registry endpoints — blueprint Module 5 API surface. */
import { Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { SchemaRegistryDTO, TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";

import { SchemaRegistryService } from "./schema-registry.service.js";

@Controller("v1")
export class SchemaRegistryController {
  constructor(private readonly schema: SchemaRegistryService) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Get("projects/:projectId/source-schema")
  getSourceSchema(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
  ): Promise<SchemaRegistryDTO.SourceSchemaSnapshotResponse> {
    return this.schema.getSourceSchema(this.ctxOrThrow(ctx), projectId);
  }

  @Get("destination-schemas/:productType/active")
  getActiveDestinationSchema(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("productType") productType: string,
  ): Promise<SchemaRegistryDTO.DestinationSchemaResponse> {
    return this.schema.getActiveDestinationSchema(this.ctxOrThrow(ctx), productType);
  }

  @Post("projects/:projectId/source-schema/refresh")
  refresh(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Req() req: unknown,
  ): Promise<SchemaRegistryDTO.RefreshSourceSchemaResponse> {
    return this.schema.refresh(this.ctxOrThrow(ctx), projectId, requestIdOf(req));
  }
}
