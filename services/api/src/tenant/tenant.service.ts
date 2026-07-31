/**
 * Tenant module — blueprint Module 2. Profile, settings, feature
 * entitlements (1-min cached). All reads/writes go through the tenant-scoped
 * Prisma client.
 */
import { Injectable } from "@nestjs/common";
import type { TenantContext, TenantDTO, TenantPlan, TenantStatus } from "@pintle/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { EventBus } from "../common/event-bus.js";
import { FeatureCache } from "../common/feature-cache.js";
import { PrismaService } from "../common/prisma.service.js";

interface TenantSettingsView {
  defaultTimezone: string;
  dataRetentionDays: number;
  defaultProductType: string;
  allowCustomerComments: boolean;
  piiMaskingEnabled: boolean;
}

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly cache: FeatureCache,
    @InjectPinoLogger(TenantService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** GET /v1/tenant */
  async getTenant(ctx: TenantContext): Promise<TenantDTO.GetTenantResponse> {
    const t = await this.prisma.tenant.tenant.findFirst();
    if (!t) throw ApiException.notFound("Tenant not found");
    this.logger.info({ tenantId: ctx.tenantId, userId: ctx.userId }, "get tenant");
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan as TenantPlan,
      status: t.status as TenantStatus,
      primaryRegion: t.primaryRegion,
    };
  }

  /** PATCH /v1/tenant/settings */
  async updateSettings(
    ctx: TenantContext,
    input: TenantDTO.UpdateTenantSettingsRequest,
    requestId: string,
  ): Promise<TenantSettingsView> {
    const updated = await this.prisma.tenant.tenantSettings.update({
      where: { tenantId: ctx.tenantId },
      data: input,
    });

    await this.events.publish({
      name: "tenant.settings.updated",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { changed: Object.keys(input) },
    });
    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, changed: Object.keys(input) },
      "tenant settings updated",
    );

    return {
      defaultTimezone: updated.defaultTimezone,
      dataRetentionDays: updated.dataRetentionDays,
      defaultProductType: updated.defaultProductType,
      allowCustomerComments: updated.allowCustomerComments,
      piiMaskingEnabled: updated.piiMaskingEnabled,
    };
  }

  /** GET /v1/tenant/features — 1-min in-memory cache. */
  async getFeatures(
    ctx: TenantContext,
    requestId: string,
  ): Promise<TenantDTO.GetTenantFeaturesResponse> {
    const cached = this.cache.get<TenantDTO.GetTenantFeaturesResponse>(ctx.tenantId);
    if (cached) {
      this.logger.debug({ tenantId: ctx.tenantId }, "features cache hit");
      return cached;
    }

    const rows = await this.prisma.tenant.featureEntitlement.findMany();
    const response: TenantDTO.GetTenantFeaturesResponse = {
      features: rows.map((r) => ({
        featureKey: r.featureKey,
        enabled: r.enabled,
        config: (r.config as Record<string, unknown> | null) ?? null,
      })),
    };
    this.cache.set(ctx.tenantId, response);

    // Stub-bus signal that a fresh entitlement snapshot is in effect.
    await this.events.publish({
      name: "tenant.feature.updated",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { count: response.features.length, source: "cache_refresh" },
    });
    this.logger.info(
      { tenantId: ctx.tenantId, count: response.features.length },
      "features cache refreshed",
    );

    return response;
  }
}
