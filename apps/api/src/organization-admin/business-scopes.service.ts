import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { BusinessScopeType } from "@nova/db";
import { EffectiveAccessService } from "../access-control/effective-access.service";
import { EvidenceService } from "../evidence/evidence.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ActorContext } from "./companies.service";

export interface CreateBusinessScopeInput {
  companyId: string;
  type: BusinessScopeType;
  name: string;
  externalId?: string;
  location?: string;
  responsiblePerson?: string;
}

@Injectable()
export class BusinessScopesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly access: EffectiveAccessService
  ) {}

  async list(actor: ActorContext, params: { companyId?: string; search?: string; page: number; pageSize: number }) {
    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const visible = await this.access.visibleBusinessScopeIds(tx, actor.membership);
      if (visible !== null && visible.length === 0) {
        return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
      }

      const where = {
        ...(visible !== null ? { id: { in: visible } } : {}),
        ...(params.companyId ? { companyId: params.companyId } : {}),
        ...(params.search ? { normalizedName: { contains: params.search.trim().toLowerCase() } } : {}),
      };

      const [items, total] = await Promise.all([
        tx.businessScope.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
          include: { company: { select: { id: true, name: true } } },
        }),
        tx.businessScope.count({ where }),
      ]);

      return { items, total, page: params.page, pageSize: params.pageSize };
    });
  }

  /** FR-115: duplicate detection surfaced to the guided-creation UI before the final confirmation step. */
  async checkDuplicate(
    actor: ActorContext,
    params: { companyId: string; type: BusinessScopeType; name: string; externalId?: string }
  ) {
    const normalizedName = params.name.trim().toLowerCase();
    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const existing = await tx.businessScope.findFirst({
        where: { organizationId: actor.organizationId, companyId: params.companyId, type: params.type, normalizedName },
      });
      return { duplicate: Boolean(existing), existing: existing ?? null };
    });
  }

  async create(actor: ActorContext, input: CreateBusinessScopeInput) {
    const normalizedName = input.name.trim().toLowerCase();
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      if (!(await this.access.hasDirectCompanyGrant(tx, actor.membership, input.companyId))) {
        throw new NotFoundException({ code: "company_not_found" });
      }
      const company = await tx.company.findUnique({ where: { id: input.companyId } });
      if (!company || company.status !== "ACTIVE") {
        throw new NotFoundException({ code: "company_not_found" });
      }

      // Concurrency-safe duplicate prevention: the unique index on
      // (organization_id, company_id, type, normalized_name) is the real
      // guard; this pre-check only produces a friendlier error message.
      const existing = await tx.businessScope.findFirst({
        where: { organizationId: actor.organizationId, companyId: input.companyId, type: input.type, normalizedName },
      });
      if (existing) throw new ConflictException({ code: "business_scope_duplicate" });

      let scope;
      try {
        scope = await tx.businessScope.create({
          data: {
            organizationId: actor.organizationId,
            companyId: input.companyId,
            type: input.type,
            name: input.name.trim(),
            normalizedName,
            externalId: input.externalId,
            location: input.location,
            responsiblePerson: input.responsiblePerson,
            status: "ACTIVE",
          },
        });
      } catch {
        // Unique-index race: two concurrent identical creations.
        throw new ConflictException({ code: "business_scope_duplicate" });
      }

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "BUSINESS_SCOPE_CREATED",
        correlationId,
        after: { businessScopeId: scope.id, name: scope.name, type: scope.type, companyId: scope.companyId },
      });

      return scope;
    });
  }

  async deactivate(actor: ActorContext, businessScopeId: string, reason: string) {
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const visible = await this.access.visibleBusinessScopeIds(tx, actor.membership);
      if (visible !== null && !visible.includes(businessScopeId)) {
        throw new NotFoundException({ code: "business_scope_not_found" });
      }
      const current = await tx.businessScope.findUnique({ where: { id: businessScopeId } });
      if (!current) throw new NotFoundException({ code: "business_scope_not_found" });
      if (current.status === "INACTIVE") return current;

      const updated = await tx.businessScope.update({
        where: { id: businessScopeId },
        data: { status: "INACTIVE", version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "BUSINESS_SCOPE_DEACTIVATED",
        reason,
        correlationId,
        before: { status: "ACTIVE" },
        after: { status: "INACTIVE" },
      });

      return updated;
    });
  }
}
