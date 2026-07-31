/**
 * Identity module — blueprint Module 1. Clerk owns authentication; this owns
 * invitations, memberships and the local user projection.
 */
import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { IdentityDTO, Role, TenantContext } from "@pintle/contracts";

import { ApiException } from "../common/api-exception.js";
import { EventBus } from "../common/event-bus.js";
import { PrismaService } from "../common/prisma.service.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  /** POST /v1/auth/invitations — tenant-scoped. */
  async createInvitation(
    ctx: TenantContext,
    input: IdentityDTO.CreateInvitationRequest,
    requestId: string,
  ): Promise<IdentityDTO.CreateInvitationResponse> {
    const token = randomUUID();
    // `tenantId` is passed to satisfy Prisma's input type; the tenant-scoped
    // client still overrides it with ctx.tenantId, so it cannot point
    // anywhere else (CLAUDE.md → Coding conventions §1).
    const invitation = await this.prisma.tenant.invitation.create({
      data: {
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedBy: ctx.userId,
      },
    });

    await this.events.publish({
      name: "identity.invitation.created",
      tenantId: ctx.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { invitationId: invitation.id, email: input.email },
    });

    // `token` would be emailed to the invitee; not returned in the API.
    return { invitationId: invitation.id, status: "invited" };
  }

  /** POST /v1/auth/invitations/accept — authenticated, no tenant membership yet. */
  async acceptInvitation(
    ctx: TenantContext,
    input: IdentityDTO.AcceptInvitationRequest,
    requestId: string,
  ): Promise<IdentityDTO.AcceptInvitationResponse> {
    const invitation = await this.prisma.base.invitation.findFirst({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!invitation || invitation.acceptedAt) {
      throw ApiException.notFound("Invitation not found or already used");
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      throw new ApiException("CONFLICT", "Invitation has expired");
    }

    const membership = await this.prisma.base.$transaction(async (tx) => {
      const created = await tx.membership.upsert({
        where: {
          tenantId_userId: {
            tenantId: invitation.tenantId,
            userId: ctx.userId,
          },
        },
        update: { status: "active", role: invitation.role },
        create: {
          tenantId: invitation.tenantId,
          userId: ctx.userId,
          role: invitation.role,
          status: "active",
          invitedBy: invitation.invitedBy,
          joinedAt: new Date(),
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    await this.events.publish({
      name: "identity.invitation.accepted",
      tenantId: invitation.tenantId,
      requestId,
      occurredAt: new Date().toISOString(),
      payload: { membershipId: membership.id, userId: ctx.userId },
    });

    return { membershipId: membership.id, tenantId: invitation.tenantId };
  }

  /** GET /v1/me — current user + active tenant + roles. */
  async me(ctx: TenantContext): Promise<IdentityDTO.MeResponse> {
    const [user, tenant] = await Promise.all([
      this.prisma.base.user.findUnique({ where: { id: ctx.userId } }),
      this.prisma.base.tenant.findUnique({ where: { id: ctx.tenantId } }),
    ]);
    if (!user || !tenant) {
      throw ApiException.notFound("User or tenant not found");
    }
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      tenant: { id: tenant.id, name: tenant.name },
      roles: ctx.roles as Role[],
    };
  }
}
