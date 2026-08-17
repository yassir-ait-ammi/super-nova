import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Membership } from "@nova/db";
import { PrismaService } from "../prisma/prisma.service";
import { EvidenceService } from "../evidence/evidence.service";
import { EffectiveAccessService } from "../access-control/effective-access.service";

export interface ActorContext {
  organizationId: string;
  membership: Membership;
  correlationId?: string;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly access: EffectiveAccessService
  ) {}

  async list(actor: ActorContext, params: { search?: string; page: number; pageSize: number }) {
    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const visible = await this.access.visibleCompanyIds(tx, actor.membership);
      if (visible !== null && visible.length === 0) {
        return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
      }

      const where = {
        ...(visible !== null ? { id: { in: visible } } : {}),
        ...(params.search ? { normalizedName: { contains: params.search.trim().toLowerCase() } } : {}),
      };

      const [items, total] = await Promise.all([
        tx.company.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
          include: { _count: { select: { businessScopes: { where: { status: "ACTIVE" } } } } },
        }),
        tx.company.count({ where }),
      ]);

      return { items, total, page: params.page, pageSize: params.pageSize };
    });
  }

  async get(actor: ActorContext, companyId: string) {
    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const visible = await this.access.visibleCompanyIds(tx, actor.membership);
      if (visible !== null && !visible.includes(companyId)) {
        throw new NotFoundException({ code: "company_not_found" });
      }
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException({ code: "company_not_found" });
      return company;
    });
  }

  async create(actor: ActorContext, name: string) {
    const normalizedName = name.trim().toLowerCase();
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const existing = await tx.company.findFirst({
        where: { organizationId: actor.organizationId, normalizedName },
      });
      if (existing) throw new ConflictException({ code: "company_name_taken" });

      const company = await tx.company.create({
        data: { organizationId: actor.organizationId, name: name.trim(), normalizedName, status: "ACTIVE" },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "COMPANY_CREATED",
        correlationId,
        after: { companyId: company.id, name: company.name },
      });

      return company;
    });
  }

  async update(actor: ActorContext, companyId: string, name: string) {
    const normalizedName = name.trim().toLowerCase();
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      if (!(await this.access.hasDirectCompanyGrant(tx, actor.membership, companyId))) {
        throw new NotFoundException({ code: "company_not_found" });
      }
      const current = await tx.company.findUnique({ where: { id: companyId } });
      if (!current) throw new NotFoundException({ code: "company_not_found" });

      const duplicate = await tx.company.findFirst({
        where: { organizationId: actor.organizationId, normalizedName, id: { not: companyId } },
      });
      if (duplicate) throw new ConflictException({ code: "company_name_taken" });

      const updated = await tx.company.update({
        where: { id: companyId },
        data: { name: name.trim(), normalizedName, version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "COMPANY_UPDATED",
        correlationId,
        before: { name: current.name },
        after: { name: updated.name },
      });

      return updated;
    });
  }

  async deactivate(actor: ActorContext, companyId: string, reason: string) {
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      if (!(await this.access.hasDirectCompanyGrant(tx, actor.membership, companyId))) {
        throw new NotFoundException({ code: "company_not_found" });
      }
      const current = await tx.company.findUnique({ where: { id: companyId } });
      if (!current) throw new NotFoundException({ code: "company_not_found" });
      if (current.status === "INACTIVE") return current;

      // A Company with active Business Scopes cannot be silently deactivated
      // by cascade — the caller gets the blocking details and a safe next
      // action (deactivate those scopes first) instead of a partial state.
      const activeScopes = await tx.businessScope.findMany({
        where: { companyId, status: "ACTIVE" },
        select: { id: true, name: true },
      });
      if (activeScopes.length > 0) {
        throw new BadRequestException({
          code: "company_has_active_business_scopes",
          details: { blockingBusinessScopes: activeScopes },
        });
      }

      const updated = await tx.company.update({
        where: { id: companyId },
        data: { status: "INACTIVE", version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "COMPANY_DEACTIVATED",
        reason,
        correlationId,
        before: { status: "ACTIVE" },
        after: { status: "INACTIVE" },
      });

      return updated;
    });
  }
}
