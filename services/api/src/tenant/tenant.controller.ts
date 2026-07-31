/** Tenant endpoints — blueprint Module 2 API surface. */
import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { TenantDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { TenantService } from "./tenant.service.js";

@Controller("v1/tenant")
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  getTenant(@CurrentTenant() ctx: TenantContext | undefined): Promise<TenantDTO.GetTenantResponse> {
    if (!ctx) throw ApiException.authRequired();
    return this.tenant.getTenant(ctx);
  }

  @Patch("settings")
  updateSettings(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Body(new ZodValidationPipe(TenantDTO.UpdateTenantSettingsRequestSchema))
    dto: TenantDTO.UpdateTenantSettingsRequest,
    @Req() req: unknown,
  ) {
    if (!ctx) throw ApiException.authRequired();
    return this.tenant.updateSettings(ctx, dto, requestIdOf(req));
  }

  @Get("features")
  getFeatures(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Req() req: unknown,
  ): Promise<TenantDTO.GetTenantFeaturesResponse> {
    if (!ctx) throw ApiException.authRequired();
    return this.tenant.getFeatures(ctx, requestIdOf(req));
  }
}
