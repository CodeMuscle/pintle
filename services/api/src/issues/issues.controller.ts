/** Issue Management endpoints (LLD §8, partial v1). */
import { Body, Controller, Param, Patch, Post, Req } from "@nestjs/common";
import { ValidationDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { IssuesService } from "./issues.service.js";

@Controller("v1/issues")
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Patch(":id")
  patch(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ValidationDTO.PatchIssueRequestSchema))
    dto: ValidationDTO.PatchIssueRequest,
    @Req() req: unknown,
  ): Promise<ValidationDTO.ValidationIssue> {
    return this.issues.patch(this.ctxOrThrow(ctx), id, dto, requestIdOf(req));
  }

  @Post("bulk-resolve")
  bulkResolve(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Body(new ZodValidationPipe(ValidationDTO.BulkResolveRequestSchema))
    dto: ValidationDTO.BulkResolveRequest,
    @Req() req: unknown,
  ): Promise<ValidationDTO.BulkResolveResponse> {
    return this.issues.bulkResolve(this.ctxOrThrow(ctx), dto, requestIdOf(req));
  }
}
