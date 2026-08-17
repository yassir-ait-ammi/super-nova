import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { EvidenceService } from "../evidence/evidence.service";
import { InvitationsService } from "../access-control/invitations.service";
import { SessionService } from "../identity/session.service";

export interface ActorContext {
  identityId: string;
  correlationId?: string;
}

export interface OrganizationDirectoryItem {
  id: string;
  name: string;
  accessStatus: string;
  commercialStatus: string;
  ownerContactEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService
  ) {}

  async create(params: { name: string; ownerEmail: string }, actor: ActorContext) {
    const normalizedName = params.name.trim().toLowerCase();
    const correlationId = actor.correlationId ?? randomUUID();

    const org = await this.prisma.withContext({ isPlatformAdmin: true }, async (tx) => {
      const existing = await tx.organization.findFirst({ where: { normalizedName } });
      if (existing) {
        throw new ConflictException({ code: "organization_name_taken" });
      }

      const created = await tx.organization.create({
        data: {
          name: params.name.trim(),
          normalizedName,
          accessStatus: "PROVISIONING",
          commercialStatus: "DEMO",
          ownerContactEmail: params.ownerEmail,
        },
      });

      await this.evidence.record(tx, {
        organizationId: created.id,
        actorIdentityId: actor.identityId,
        actorIsPlatformAdmin: true,
        action: "ORGANIZATION_PROVISIONED",
        correlationId,
        after: { accessStatus: "PROVISIONING", name: created.name },
      });

      return created;
    });

    await this.invitations.createInitialOwnerInvitation({
      organizationId: org.id,
      organizationName: org.name,
      ownerEmail: params.ownerEmail,
      actorPlatformAdminIdentityId: actor.identityId,
      correlationId,
    });

    return { id: org.id, name: org.name, accessStatus: org.accessStatus };
  }

  async list(params: { search?: string; page: number; pageSize: number }): Promise<{
    items: OrganizationDirectoryItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.prisma.withContext({ isPlatformAdmin: true }, async (tx) => {
      const where = params.search
        ? { normalizedName: { contains: params.search.trim().toLowerCase() } }
        : {};

      const [items, total] = await Promise.all([
        tx.organization.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
          select: {
            id: true,
            name: true,
            accessStatus: true,
            commercialStatus: true,
            ownerContactEmail: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        tx.organization.count({ where }),
      ]);

      return { items, total, page: params.page, pageSize: params.pageSize };
    });
  }

  async get(organizationId: string) {
    const org = await this.prisma.withContext({ isPlatformAdmin: true, organizationId }, (tx) =>
      tx.organization.findUnique({ where: { id: organizationId } })
    );
    if (!org) throw new NotFoundException({ code: "organization_not_found" });
    return org;
  }

  private async transitionAccessStatus(
    organizationId: string,
    params: { from: string[]; to: "SUSPENDED" | "ACTIVE" | "DISABLED"; reason: string; action: string },
    actor: ActorContext
  ) {
    const correlationId = actor.correlationId ?? randomUUID();

    const org = await this.prisma.withContext({ isPlatformAdmin: true, organizationId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; access_status: string; version: number }>>`
        SELECT id, access_status, version FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException({ code: "organization_not_found" });
      if (!params.from.includes(current.access_status)) {
        throw new BadRequestException({ code: "invalid_organization_lifecycle_transition" });
      }

      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: {
          accessStatus: params.to,
          version: { increment: 1 },
          suspendedAt: params.to === "SUSPENDED" ? new Date() : undefined,
          disabledAt: params.to === "DISABLED" ? new Date() : undefined,
        },
      });

      await this.evidence.record(tx, {
        organizationId,
        actorIdentityId: actor.identityId,
        actorIsPlatformAdmin: true,
        action: params.action,
        reason: params.reason,
        correlationId,
        before: { accessStatus: current.access_status },
        after: { accessStatus: params.to },
      });

      return updated;
    });

    // Immediate revocation (SEC-07): suspend/disable ends every open session
    // belonging to this Organization's members right away.
    if (params.to === "SUSPENDED" || params.to === "DISABLED") {
      const memberIdentityIds = await this.prisma.withContext({ organizationId }, (tx) =>
        tx.membership.findMany({ where: { organizationId, state: "ACTIVE" }, select: { identityId: true } })
      );
      await Promise.all(
        memberIdentityIds.map((m) =>
          this.sessions.revokeAllForIdentity(m.identityId, `organization_${params.to.toLowerCase()}`)
        )
      );
    }

    return org;
  }

  suspend(organizationId: string, reason: string, actor: ActorContext) {
    return this.transitionAccessStatus(
      organizationId,
      { from: ["ACTIVE"], to: "SUSPENDED", reason, action: "ORGANIZATION_SUSPENDED" },
      actor
    );
  }

  reactivate(organizationId: string, reason: string, actor: ActorContext) {
    return this.transitionAccessStatus(
      organizationId,
      { from: ["SUSPENDED"], to: "ACTIVE", reason, action: "ORGANIZATION_REACTIVATED" },
      actor
    );
  }

  disable(organizationId: string, reason: string, actor: ActorContext) {
    return this.transitionAccessStatus(
      organizationId,
      { from: ["ACTIVE", "SUSPENDED"], to: "DISABLED", reason, action: "ORGANIZATION_DISABLED" },
      actor
    );
  }

  async updateCommercialStatus(
    organizationId: string,
    commercialStatus: "DEMO" | "PILOT" | "ACTIVE",
    reason: string,
    actor: ActorContext
  ) {
    const correlationId = actor.correlationId ?? randomUUID();
    return this.prisma.withContext({ isPlatformAdmin: true, organizationId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; commercial_status: string }>>`
        SELECT id, commercial_status FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException({ code: "organization_not_found" });

      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: { commercialStatus, version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId,
        actorIdentityId: actor.identityId,
        actorIsPlatformAdmin: true,
        action: "ORGANIZATION_COMMERCIAL_STATUS_CHANGED",
        reason,
        correlationId,
        before: { commercialStatus: current.commercial_status },
        after: { commercialStatus },
      });

      return updated;
    });
  }
}
