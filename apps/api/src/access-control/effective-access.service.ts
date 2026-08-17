import { Injectable } from "@nestjs/common";
import type { Membership, Prisma } from "@nova/db";

/** `null` means "no filter needed — full Organization access" (Administrator or platform admin). */
export type IdFilter = string[] | null;

/**
 * Resolves which Companies/Business Scopes a `User` membership can see,
 * from their explicit MembershipScopeGrant rows. Organization scope
 * descends to Companies and their scopes; Company scope descends only to
 * its own scopes; scope grants never ascend (FR-116). Administrators never
 * consult this — full Organization access is implied by profile.
 */
@Injectable()
export class EffectiveAccessService {
  async visibleCompanyIds(tx: Prisma.TransactionClient, membership: Membership): Promise<IdFilter> {
    if (membership.profile === "ADMINISTRATOR") return null;

    const grants = await tx.membershipScopeGrant.findMany({
      where: { membershipId: membership.id },
      select: { companyId: true, businessScopeId: true },
    });

    const directCompanyIds = grants.map((g) => g.companyId).filter((id): id is string => Boolean(id));
    const viaScopeIds = grants.map((g) => g.businessScopeId).filter((id): id is string => Boolean(id));

    let companiesFromScopes: string[] = [];
    if (viaScopeIds.length > 0) {
      const scopes = await tx.businessScope.findMany({
        where: { id: { in: viaScopeIds } },
        select: { companyId: true },
      });
      companiesFromScopes = scopes.map((s) => s.companyId);
    }

    return [...new Set([...directCompanyIds, ...companiesFromScopes])];
  }

  async visibleBusinessScopeIds(tx: Prisma.TransactionClient, membership: Membership): Promise<IdFilter> {
    if (membership.profile === "ADMINISTRATOR") return null;

    const grants = await tx.membershipScopeGrant.findMany({
      where: { membershipId: membership.id },
      select: { companyId: true, businessScopeId: true },
    });

    const directScopeIds = grants.map((g) => g.businessScopeId).filter((id): id is string => Boolean(id));
    const viaCompanyIds = grants.map((g) => g.companyId).filter((id): id is string => Boolean(id));

    let scopesFromCompanies: string[] = [];
    if (viaCompanyIds.length > 0) {
      const scopes = await tx.businessScope.findMany({
        where: { companyId: { in: viaCompanyIds } },
        select: { id: true },
      });
      scopesFromCompanies = scopes.map((s) => s.id);
    }

    return [...new Set([...directScopeIds, ...scopesFromCompanies])];
  }

  /** True only for a User with a direct (non-descended) grant on this exact Company. */
  async hasDirectCompanyGrant(tx: Prisma.TransactionClient, membership: Membership, companyId: string): Promise<boolean> {
    if (membership.profile === "ADMINISTRATOR") return true;
    const grant = await tx.membershipScopeGrant.findFirst({
      where: { membershipId: membership.id, companyId },
    });
    return Boolean(grant);
  }
}
