/**
 * Identity endpoints — blueprint Module 1 API surface.
 *   POST /v1/auth/invitations          (tenant-scoped)
 *   POST /v1/auth/invitations/accept   (authenticated; no membership yet)
 *   GET  /v1/me
 * Handlers return bare data; the global interceptor adds the success envelope.
 */
import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { IdentityDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { SkipTenantCheck } from "../common/decorators.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { IdentityService } from "./identity.service.js";

@Controller("v1")
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post("auth/invitations")
  createInvitation(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Body(new ZodValidationPipe(IdentityDTO.CreateInvitationRequestSchema))
    dto: IdentityDTO.CreateInvitationRequest,
    @Req() req: unknown,
  ): Promise<IdentityDTO.CreateInvitationResponse> {
    if (!ctx) throw ApiException.authRequired();
    return this.identity.createInvitation(ctx, dto, requestIdOf(req));
  }

  @Post("auth/invitations/accept")
  @SkipTenantCheck()
  acceptInvitation(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Body(new ZodValidationPipe(IdentityDTO.AcceptInvitationRequestSchema))
    dto: IdentityDTO.AcceptInvitationRequest,
    @Req() req: unknown,
  ): Promise<IdentityDTO.AcceptInvitationResponse> {
    if (!ctx) throw ApiException.authRequired();
    return this.identity.acceptInvitation(ctx, dto, requestIdOf(req));
  }

  @Get("me")
  me(@CurrentTenant() ctx: TenantContext | undefined): Promise<IdentityDTO.MeResponse> {
    if (!ctx) throw ApiException.authRequired();
    return this.identity.me(ctx);
  }
}
