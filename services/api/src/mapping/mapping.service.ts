/**
 * Mapping — blueprint Module 6. Draft editor + immutable published versions
 * + diff. Concurrency:
 *   - Bulk upsert is a delete-then-insert in one transaction (the brief's
 *     "atomically replace all draft mappings for (project, snapshot, dest)").
 *   - Publish takes a project-row lock (FOR UPDATE) before reading the max
 *     version_number — so two concurrent publishes can't pick the same
 *     monotonic number. The client also sends `If-Match: <draftUpdatedAt>`
 *     for optimistic concurrency on the draft itself; a mismatch is a
 *     CONFLICT (stale draft) rather than silently overwriting.
 */
import { Injectable } from "@nestjs/common";
import type { MappingDTO, TenantContext } from "@pintle/contracts";
import { Prisma, prisma as basePrisma } from "@pintle/db";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ApiException } from "../common/api-exception.js";
import { keysetPage } from "../common/cursor.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";

import { BUILTIN_RULE_DEFS } from "./transform-rules.js";

@Injectable()
export class MappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    @InjectPinoLogger(MappingService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Lazy per-tenant seed of the 6 built-in transform rules. Idempotent. */
  async ensureBuiltinTransformRules(tenantId: string): Promise<MappingDTO.TransformRule[]> {
    const existing = await this.prisma.tenant.transformRule.findMany({
      where: {
        ruleKey: { in: BUILTIN_RULE_DEFS.map((d) => d.ruleKey) },
        projectId: null,
      },
    });
    const byKey = new Map(existing.map((r) => [r.ruleKey, r]));
    const missing = BUILTIN_RULE_DEFS.filter((d) => !byKey.has(d.ruleKey));
    if (missing.length > 0) {
      await this.prisma.tenant.transformRule.createMany({
        data: missing.map((d) => ({
          tenantId,
          ruleKey: d.ruleKey,
          displayName: d.displayName,
          ruleConfig: d.defaultConfig as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    const all = await this.prisma.tenant.transformRule.findMany({
      where: {
        ruleKey: { in: BUILTIN_RULE_DEFS.map((d) => d.ruleKey) },
        projectId: null,
      },
      orderBy: { ruleKey: "asc" },
    });
    return all.map((r) => ({
      id: r.id,
      ruleKey: r.ruleKey as MappingDTO.BuiltinTransformRuleKey,
      displayName: r.displayName,
      config: (r.ruleConfig ?? {}) as Record<string, unknown>,
    }));
  }

  private async requireProject(projectId: string) {
    const p = await this.prisma.tenant.migrationProject.findUnique({
      where: { id: projectId },
    });
    if (!p) throw ApiException.notFound("Project not found");
    return p;
  }

  /** Latest non-failed snapshot for the project, or null. */
  private async latestSnapshot(projectId: string) {
    return this.prisma.tenant.sourceSchemaSnapshot.findFirst({
      where: { projectId, version: { gte: 1 } },
      orderBy: { version: "desc" },
    });
  }

  /** Active destination schema for productType — tenant-specific wins. */
  private async activeDestinationSchema(tenantId: string, productType: string) {
    return basePrisma.destinationSchema.findFirst({
      where: {
        productType,
        status: "active",
        OR: [{ tenantId }, { tenantId: null }],
      },
      orderBy: [{ tenantId: "desc" }, { version: "desc" }],
    });
  }

  private toDraft(row: {
    id: string;
    sourceFieldKey: string | null;
    destinationFieldKey: string;
    mappingType: string;
    transformRuleId: string | null;
    defaultValue: unknown;
    config: unknown;
    isRequiredOverride: boolean | null;
    updatedAt: Date;
  }): MappingDTO.MappingDraft {
    return {
      id: row.id,
      sourceFieldKey: row.sourceFieldKey ?? undefined,
      destinationFieldKey: row.destinationFieldKey,
      mappingType: row.mappingType as MappingDTO.MappingDraft["mappingType"],
      transformRuleId: row.transformRuleId ?? undefined,
      defaultValue: row.defaultValue ?? undefined,
      config: (row.config as Record<string, unknown> | null) ?? undefined,
      isRequiredOverride: row.isRequiredOverride ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** GET /v1/projects/:projectId/mappings */
  async getMappings(
    ctx: TenantContext,
    projectId: string,
  ): Promise<MappingDTO.GetMappingsResponse> {
    const project = await this.requireProject(projectId);
    const [snapshot, destSchema, transformRules] = await Promise.all([
      this.latestSnapshot(projectId),
      this.activeDestinationSchema(ctx.tenantId, project.targetProductType),
      this.ensureBuiltinTransformRules(ctx.tenantId),
    ]);

    const drafts =
      snapshot && destSchema
        ? await this.prisma.tenant.fieldMapping.findMany({
            where: {
              projectId,
              sourceSnapshotId: snapshot.id,
              destinationSchemaId: destSchema.id,
              status: "draft",
            },
            orderBy: { destinationFieldKey: "asc" },
          })
        : [];

    const destFields =
      (
        destSchema?.schemaJson as {
          fields?: Array<{ fieldKey: string; displayName?: string; isRequired?: boolean }>;
        } | null
      )?.fields ?? [];
    const mappedKeys = new Set(drafts.map((d) => d.destinationFieldKey));
    const unresolved = destFields
      .filter((f) => !mappedKeys.has(f.fieldKey))
      .map((f) => ({
        fieldKey: f.fieldKey,
        displayName: f.displayName,
        isRequired: f.isRequired,
      }));

    // Template suggestions: filter by target product type, and (if any data
    // source on the project has an external_system_name) by that.
    const ds = await this.prisma.tenant.dataSource.findFirst({
      where: { projectId, externalSystemName: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    const templates = await basePrisma.mappingTemplate.findMany({
      where: {
        targetProductType: project.targetProductType,
        ...(ds?.externalSystemName ? { sourceSystemName: ds.externalSystemName } : {}),
        OR: [{ tenantId: ctx.tenantId }, { tenantId: null }],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        drafts: drafts.length,
        unresolved: unresolved.length,
      },
      "mappings read",
    );

    return {
      sourceSnapshotId: snapshot?.id ?? null,
      destinationSchemaId: destSchema?.id ?? null,
      drafts: drafts.map((d) => this.toDraft(d)),
      unresolvedDestinationFields: unresolved,
      templateSuggestions: templates.map((t) => ({
        id: t.id,
        templateName: t.templateName,
        sourceSystemName: t.sourceSystemName,
        targetProductType: t.targetProductType,
      })),
      transformRules,
    };
  }

  /** PUT /v1/projects/:projectId/mappings — atomic replace of drafts. */
  async upsertMappings(
    ctx: TenantContext,
    projectId: string,
    dto: MappingDTO.UpsertMappingsRequest,
    requestId: string,
  ): Promise<MappingDTO.UpsertMappingsResponse> {
    await this.requireProject(projectId);

    const snapshot = await this.prisma.tenant.sourceSchemaSnapshot.findUnique({
      where: { id: dto.sourceSnapshotId },
    });
    if (!snapshot || snapshot.projectId !== projectId) {
      throw new ApiException(
        "VALIDATION_FAILED",
        "sourceSnapshotId does not belong to this project",
        [{ field: "sourceSnapshotId", issue: "not found for project" }],
      );
    }
    const destSchema = await basePrisma.destinationSchema.findFirst({
      where: {
        id: dto.destinationSchemaId,
        status: "active",
        OR: [{ tenantId: ctx.tenantId }, { tenantId: null }],
      },
    });
    if (!destSchema) {
      throw new ApiException(
        "VALIDATION_FAILED",
        "destinationSchemaId not active or not visible to this tenant",
        [{ field: "destinationSchemaId", issue: "not found / inactive" }],
      );
    }

    // Ensure builtins + validate any transform mappings reference a known rule.
    const transformRules = await this.ensureBuiltinTransformRules(ctx.tenantId);
    const validRuleIds = new Set(transformRules.map((r) => r.id));
    for (const m of dto.mappings) {
      if (m.mappingType === "transform") {
        if (!m.transformRuleId || !validRuleIds.has(m.transformRuleId)) {
          throw new ApiException(
            "VALIDATION_FAILED",
            `mapping for "${m.destinationFieldKey}" uses transform but transformRuleId is missing or unknown`,
            [{ field: "transformRuleId", issue: "must reference an existing rule" }],
          );
        }
      }
    }

    const now = new Date();
    const draftCount = await this.prisma.tenant.$transaction(async (tx) => {
      await tx.fieldMapping.deleteMany({
        where: {
          projectId,
          sourceSnapshotId: dto.sourceSnapshotId,
          destinationSchemaId: dto.destinationSchemaId,
          status: "draft",
        },
      });
      if (dto.mappings.length > 0) {
        await tx.fieldMapping.createMany({
          data: dto.mappings.map((m) => ({
            tenantId: ctx.tenantId,
            projectId,
            sourceSnapshotId: dto.sourceSnapshotId,
            destinationSchemaId: dto.destinationSchemaId,
            sourceFieldKey: m.sourceFieldKey ?? "",
            destinationFieldKey: m.destinationFieldKey,
            mappingType: m.mappingType,
            transformRuleId: m.transformRuleId ?? null,
            defaultValue:
              m.defaultValue === undefined
                ? Prisma.DbNull
                : (m.defaultValue as Prisma.InputJsonValue),
            config: m.config === undefined ? Prisma.DbNull : (m.config as Prisma.InputJsonValue),
            isRequiredOverride: m.isRequiredOverride ?? null,
            status: "draft",
          })),
        });
      }
      return dto.mappings.length;
    });

    await this.events.publish({
      name: "mapping.draft.updated",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: now.toISOString(),
      payload: { projectId, draftCount },
    });
    this.logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, draftCount },
      "mapping drafts upserted",
    );

    return { draftCount, draftUpdatedAt: now.toISOString() };
  }

  /** Max updated_at across drafts for the (project, snapshot, dest) tuple. */
  private async currentDraftFingerprint(
    projectId: string,
    snapshotId: string,
    destSchemaId: string,
  ): Promise<string | null> {
    const drafts = await this.prisma.tenant.fieldMapping.findMany({
      where: {
        projectId,
        sourceSnapshotId: snapshotId,
        destinationSchemaId: destSchemaId,
        status: "draft",
      },
      select: { updatedAt: true },
    });
    if (drafts.length === 0) return null;
    return drafts.map((d) => d.updatedAt.toISOString()).reduce((a, b) => (a > b ? a : b));
  }

  /** POST /v1/projects/:projectId/mappings/publish */
  async publish(
    ctx: TenantContext,
    projectId: string,
    ifMatch: string | undefined,
    dto: MappingDTO.PublishMappingRequest,
    requestId: string,
  ): Promise<MappingDTO.PublishMappingResponse> {
    const project = await this.requireProject(projectId);

    // Locate the (snapshot, dest) tuple from the current drafts.
    const anyDraft = await this.prisma.tenant.fieldMapping.findFirst({
      where: { projectId, status: "draft" },
    });
    if (!anyDraft) {
      throw new ApiException("CONFLICT", "No draft mappings to publish — PUT /mappings first");
    }
    const snapshotId = anyDraft.sourceSnapshotId;
    const destSchemaId = anyDraft.destinationSchemaId;

    // Optimistic concurrency on the draft.
    if (!ifMatch) {
      throw new ApiException(
        "VALIDATION_FAILED",
        "If-Match header (current draft updatedAt) is required for publish",
      );
    }
    const fp = await this.currentDraftFingerprint(projectId, snapshotId, destSchemaId);
    if (fp !== ifMatch) {
      throw new ApiException(
        "CONFLICT",
        "Draft has moved since you fetched it — refresh and retry",
      );
    }

    const drafts = await this.prisma.tenant.fieldMapping.findMany({
      where: {
        projectId,
        sourceSnapshotId: snapshotId,
        destinationSchemaId: destSchemaId,
        status: "draft",
      },
      orderBy: { destinationFieldKey: "asc" },
    });
    const mappingJson = {
      mappings: drafts.map((d) => ({
        sourceFieldKey: d.sourceFieldKey || undefined,
        destinationFieldKey: d.destinationFieldKey,
        mappingType: d.mappingType,
        transformRuleId: d.transformRuleId ?? undefined,
        defaultValue: d.defaultValue ?? undefined,
        config: d.config ?? undefined,
        isRequiredOverride: d.isRequiredOverride ?? undefined,
      })),
    };

    // Serialise concurrent publishes per project by locking the project row.
    const version = await basePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1 FROM migration_projects
        WHERE id = ${projectId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
        FOR UPDATE
      `;
      const max = await tx.mappingVersion.aggregate({
        where: { tenantId: ctx.tenantId, projectId },
        _max: { versionNumber: true },
      });
      const next = (max._max.versionNumber ?? 0) + 1;
      return tx.mappingVersion.create({
        data: {
          tenantId: ctx.tenantId,
          projectId,
          sourceSnapshotId: snapshotId,
          destinationSchemaId: destSchemaId,
          versionNumber: next,
          status: "published",
          mappingJson: mappingJson as unknown as Prisma.InputJsonValue,
          publishedBy: ctx.userId,
          publishedAt: new Date(),
          notes: dto.notes ?? null,
        },
      });
    });

    await this.events.publish({
      name: "mapping.version.published",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: {
        projectId,
        mappingVersionId: version.id,
        versionNumber: version.versionNumber,
      },
    });
    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        versionNumber: version.versionNumber,
        mappingVersionId: version.id,
        projectName: project.name,
      },
      "mapping version published",
    );

    return {
      mappingVersionId: version.id,
      versionNumber: version.versionNumber,
      status: "published",
    };
  }

  /** GET /v1/projects/:projectId/mappings/versions — cursor paginated. */
  async listVersions(
    ctx: TenantContext,
    projectId: string,
    q: MappingDTO.ListMappingVersionsQuery,
  ): Promise<MappingDTO.ListMappingVersionsResponse> {
    await this.requireProject(projectId);

    const { items, nextCursor } = await keysetPage(q.cursor, q.limit, (after, take) =>
      this.prisma.tenant.mappingVersion.findMany({
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
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId, count: items.length },
      "mapping versions listed",
    );
    return {
      items: items.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status as MappingDTO.MappingVersionSummary["status"],
        publishedBy: v.publishedBy,
        publishedAt: v.publishedAt.toISOString(),
        notes: v.notes,
      })),
      nextCursor,
    };
  }

  /** GET /v1/projects/:projectId/mappings/diff?from=&to= */
  async diffVersions(
    ctx: TenantContext,
    projectId: string,
    q: MappingDTO.MappingDiffQuery,
  ): Promise<MappingDTO.MappingDiffResponse> {
    await this.requireProject(projectId);

    const versions = await this.prisma.tenant.mappingVersion.findMany({
      where: { projectId, versionNumber: { in: [q.from, q.to] } },
    });
    const fromV = versions.find((v) => v.versionNumber === q.from);
    const toV = versions.find((v) => v.versionNumber === q.to);
    if (!fromV || !toV) {
      throw ApiException.notFound(`One or both versions not found (from=${q.from}, to=${q.to})`);
    }

    const fromMap = mapByDestField(fromV.mappingJson);
    const toMap = mapByDestField(toV.mappingJson);

    const added: MappingDTO.MappingDiffEntry[] = [];
    const changed: MappingDTO.MappingDiffEntry[] = [];
    const removed: MappingDTO.MappingDiffEntry[] = [];

    for (const [key, to] of toMap) {
      const from = fromMap.get(key);
      if (!from) added.push({ destinationFieldKey: key, to });
      else if (!mappingsEqual(from, to)) changed.push({ destinationFieldKey: key, from, to });
    }
    for (const [key, from] of fromMap) {
      if (!toMap.has(key)) removed.push({ destinationFieldKey: key, from });
    }

    this.logger.info(
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        projectId,
        from: q.from,
        to: q.to,
        added: added.length,
        changed: changed.length,
        removed: removed.length,
      },
      "mapping diff computed",
    );
    return {
      fromVersion: q.from,
      toVersion: q.to,
      added,
      changed,
      removed,
    };
  }
}

function mapByDestField(json: unknown): Map<string, MappingDTO.MappingInput> {
  const entries = (json as { mappings?: MappingDTO.MappingInput[] } | null)?.mappings ?? [];
  return new Map(entries.map((m) => [m.destinationFieldKey, m]));
}

function mappingsEqual(a: MappingDTO.MappingInput, b: MappingDTO.MappingInput): boolean {
  return (
    a.sourceFieldKey === b.sourceFieldKey &&
    a.mappingType === b.mappingType &&
    a.transformRuleId === b.transformRuleId &&
    JSON.stringify(a.defaultValue ?? null) === JSON.stringify(b.defaultValue ?? null) &&
    JSON.stringify(a.config ?? null) === JSON.stringify(b.config ?? null) &&
    !!a.isRequiredOverride === !!b.isRequiredOverride
  );
}
