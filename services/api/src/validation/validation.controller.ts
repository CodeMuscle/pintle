/** Validation endpoints — LLD §7. */
import { Body, Controller, Get, Param, Post, Query, Req, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { ValidationDTO } from "@pintle/contracts";
import type { TenantContext } from "@pintle/contracts";
import { Observable } from "rxjs";

import { ApiException } from "../common/api-exception.js";
import { SkipEnvelope } from "../common/decorators.js";
import { EventBus } from "../common/event-bus.js";
import { requestIdOf } from "../common/request-id.js";
import { CurrentTenant } from "../common/tenant-context.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";

import { ValidationService } from "./validation.service.js";

const RUN_EVENTS = [
  "validation.started",
  "validation.progress",
  "validation.completed",
  "validation.failed",
  "issues.generated",
] as const;

@Controller("v1")
export class ValidationController {
  constructor(
    private readonly validation: ValidationService,
    private readonly events: EventBus,
  ) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Post("migration-projects/:projectId/validate")
  createRun(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(ValidationDTO.CreateValidationRunRequestSchema))
    dto: ValidationDTO.CreateValidationRunRequest,
    @Req() req: unknown,
  ): Promise<ValidationDTO.CreateValidationRunResponse> {
    return this.validation.createRun(this.ctxOrThrow(ctx), projectId, dto, requestIdOf(req));
  }

  @Get("validation-runs/:runId")
  getRun(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("runId") runId: string,
  ): Promise<ValidationDTO.ValidationRun> {
    return this.validation.getRun(this.ctxOrThrow(ctx), runId);
  }

  @Get("validation-runs/:runId/summary")
  getRunSummary(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("runId") runId: string,
  ): Promise<ValidationDTO.ValidationRunSummaryResponse> {
    return this.validation.getRunSummary(this.ctxOrThrow(ctx), runId);
  }

  /** SSE live progress for a run. Emits a snapshot frame, then streams events. */
  @Sse("validation-runs/:runId/events")
  @SkipEnvelope()
  async runEvents(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("runId") runId: string,
  ): Promise<Observable<MessageEvent>> {
    const c = this.ctxOrThrow(ctx);
    const run = await this.validation.getRun(c, runId);

    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: "snapshot", data: run });
      const unsubs = RUN_EVENTS.map((name) =>
        this.events.subscribe(name, (event) => {
          const payload = event.payload as { runId?: string };
          if (payload?.runId === runId) {
            subscriber.next({
              type: event.name,
              data: { runId, ...(event.payload as object) },
            });
          }
        }),
      );
      return () => unsubs.forEach((u) => u());
    });
  }
}

@Controller("v1/migration-projects/:projectId/issues")
export class ProjectIssuesController {
  constructor(private readonly validation: ValidationService) {}

  private ctxOrThrow(ctx: TenantContext | undefined): TenantContext {
    if (!ctx) throw ApiException.authRequired();
    return ctx;
  }

  @Get()
  list(
    @CurrentTenant() ctx: TenantContext | undefined,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(ValidationDTO.ListIssuesQuerySchema))
    q: ValidationDTO.ListIssuesQuery,
  ): Promise<ValidationDTO.ListIssuesResponse> {
    return this.validation.listIssues(this.ctxOrThrow(ctx), projectId, q);
  }
}
