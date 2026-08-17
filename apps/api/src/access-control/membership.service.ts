import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Membership, Prisma } from "@nova/db";
import { OWNERSHIP_TRANSFER_TTL_DAYS } from "@nova/shared";
import { EvidenceService } from "../evidence/evidence.service";
import { SessionService } from "../identity/session.service";
import { PrismaService } from "../prisma/prisma.service";

export interface OrgActorContext {
  organizationId: string;
  membership: Membership;
  correlationId?: string;
}

export interface ScopeGrantInput {
  companyId?: string;
  businessScopeId?: string;
}

async function assertGrantsBelongToOrg(
  tx: Prisma.TransactionClient,
  organizationId: string,
  grants: ScopeGrantInput[]
): Promise<void> {
  const companyIds = grants.map((g) => g.companyId).filter((v): v is string => Boolean(v));
  const scopeIds = grants.map((g) => g.businessScopeId).filter((v): v is string => Boolean(v));

  if (companyIds.length > 0) {
    const found = await tx.company.count({ where: { id: { in: companyIds }, organizationId } });
    if (found !== new Set(companyIds).size) throw new BadRequestException({ code: "invalid_scope_grant" });
  }
  if (scopeIds.length > 0) {
    const found = await tx.businessScope.count({ where: { id: { in: scopeIds }, organizationId } });
    if (found !== new Set(scopeIds).size) throw new BadRequestException({ code: "invalid_scope_grant" });
  }
}

async function replaceGrantsAndCapabilities(
  tx: Prisma.TransactionClient,
  organizationId: string,
  membershipId: string,
  capabilities: string[],
  scopeGrants: ScopeGrantInput[]
): Promise<void> {
  await tx.membershipCapability.deleteMany({ where: { membershipId } });
  await tx.membershipScopeGrant.deleteMany({ where: { membershipId } });

  if (capabilities.length > 0) {
    await tx.membershipCapability.createMany({
      data: [...new Set(capabilities)].map((capability) => ({ organizationId, membershipId, capability })),
    });
  }
  if (scopeGrants.length > 0) {
    await tx.membershipScopeGrant.createMany({
      data: scopeGrants.map((g) => ({
        organizationId,
        membershipId,
        companyId: g.companyId ?? null,
        businessScopeId: g.businessScopeId ?? null,
      })),
    });
  }
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly sessions: SessionService
  ) {}

  async list(actor: OrgActorContext) {
    return this.prisma.withContext({ organizationId: actor.organizationId }, (tx) =>
      tx.membership.findMany({
        where: { organizationId: actor.organizationId },
        include: {
          identity: { select: { displayEmail: true } },
          capabilities: true,
          scopeGrants: true,
        },
        orderBy: { createdAt: "asc" },
      })
    );
  }

  async updatePermissions(
    actor: OrgActorContext,
    targetMembershipId: string,
    params: { presetKey?: string; capabilities: string[]; scopeGrants: ScopeGrantInput[] }
  ) {
    const correlationId = actor.correlationId ?? randomUUID();

    const result = await this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: targetMembershipId, organizationId: actor.organizationId },
      });
      if (!target) throw new NotFoundException({ code: "member_not_found" });
      if (target.profile !== "USER") {
        throw new BadRequestException({ code: "permissions_apply_to_users_only" });
      }

      await assertGrantsBelongToOrg(tx, actor.organizationId, params.scopeGrants);
      await replaceGrantsAndCapabilities(tx, actor.organizationId, target.id, params.capabilities, params.scopeGrants);

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { presetKey: params.presetKey ?? null, version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "MEMBER_PERMISSIONS_UPDATED",
        correlationId,
        after: { membershipId: target.id, capabilities: params.capabilities, presetKey: params.presetKey ?? null },
      });

      return updated;
    });

    // SEC-07: permission reduction immediately invalidates stale access —
    // simplest correct rule is to always revoke and require a fresh session.
    await this.sessions.revokeAllForIdentity(result.identityId, "permissions_updated");
    return result;
  }

  private async assertNotLastActiveAdministrator(tx: Prisma.TransactionClient, organizationId: string, membershipId: string) {
    const target = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!target || target.profile !== "ADMINISTRATOR") return;
    const activeAdminCount = await tx.membership.count({
      where: { organizationId, profile: "ADMINISTRATOR", state: "ACTIVE" },
    });
    if (activeAdminCount <= 1) {
      throw new BadRequestException({ code: "cannot_remove_last_administrator" });
    }
  }

  async suspend(actor: OrgActorContext, targetMembershipId: string, reason: string) {
    return this.transitionState(actor, targetMembershipId, {
      from: ["ACTIVE"],
      to: "SUSPENDED",
      reason,
      action: "MEMBER_SUSPENDED",
      revokeSessions: true,
      blockOwner: true,
    });
  }

  async reactivate(actor: OrgActorContext, targetMembershipId: string, reason: string) {
    return this.transitionState(actor, targetMembershipId, {
      from: ["SUSPENDED"],
      to: "ACTIVE",
      reason,
      action: "MEMBER_REACTIVATED",
      revokeSessions: false,
      blockOwner: false,
    });
  }

  async remove(actor: OrgActorContext, targetMembershipId: string, reason: string) {
    return this.transitionState(actor, targetMembershipId, {
      from: ["ACTIVE", "SUSPENDED"],
      to: "REMOVED",
      reason,
      action: "MEMBER_REMOVED",
      revokeSessions: true,
      blockOwner: true,
    });
  }

  private async transitionState(
    actor: OrgActorContext,
    targetMembershipId: string,
    params: {
      from: string[];
      to: "ACTIVE" | "SUSPENDED" | "REMOVED";
      reason: string;
      action: string;
      revokeSessions: boolean;
      blockOwner: boolean;
    }
  ) {
    const correlationId = actor.correlationId ?? randomUUID();

    const result = await this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      // Row-locked before being read: this transaction must serialize
      // against a concurrent ownership-transfer acceptance (or another
      // state transition) on the same membership, or the two can each read
      // pre-conflict state and both commit — e.g. a transfer accept and a
      // suspend racing on the same target can otherwise both succeed,
      // leaving isOwner=true on a SUSPENDED row (SEC-08: an active
      // Organization must have exactly one active owner).
      const lockRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM memberships WHERE id = ${targetMembershipId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE
      `;
      if (!lockRows[0]) throw new NotFoundException({ code: "member_not_found" });

      const target = await tx.membership.findFirst({
        where: { id: targetMembershipId, organizationId: actor.organizationId },
      });
      if (!target) throw new NotFoundException({ code: "member_not_found" });

      // The current owner cannot be suspended or removed before a
      // successful ownership transfer (FR-089).
      if (params.blockOwner && target.isOwner) {
        throw new ForbiddenException({ code: "cannot_suspend_or_remove_owner" });
      }
      if (params.to !== "ACTIVE") {
        await this.assertNotLastActiveAdministrator(tx, actor.organizationId, target.id);
      }
      if (!params.from.includes(target.state)) {
        throw new BadRequestException({ code: "invalid_member_lifecycle_transition" });
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: {
          state: params.to,
          version: { increment: 1 },
          suspendedAt: params.to === "SUSPENDED" ? new Date() : target.suspendedAt,
          removedAt: params.to === "REMOVED" ? new Date() : target.removedAt,
        },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: params.action,
        reason: params.reason,
        correlationId,
        before: { state: target.state },
        after: { state: params.to },
      });

      return updated;
    });

    if (params.revokeSessions) {
      await this.sessions.revokeAllForIdentity(result.identityId, params.action.toLowerCase());
    }
    return result;
  }

  /** Owner-only, distinct sensitive action — grants Organization Administrator, never platform access, never transfers ownership. */
  async promote(actor: OrgActorContext, targetMembershipId: string, reason: string) {
    const correlationId = actor.correlationId ?? randomUUID();

    const updated = await this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: targetMembershipId, organizationId: actor.organizationId },
      });
      if (!target) throw new NotFoundException({ code: "member_not_found" });
      if (target.profile !== "USER" || target.state !== "ACTIVE") {
        throw new BadRequestException({ code: "member_not_eligible_for_promotion" });
      }

      const promoted = await tx.membership.update({
        where: { id: target.id },
        data: { profile: "ADMINISTRATOR", version: { increment: 1 } },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "MEMBER_PROMOTED",
        reason,
        correlationId,
        before: { profile: "USER" },
        after: { profile: "ADMINISTRATOR" },
      });

      return promoted;
    });

    // Session rotation on privilege elevation (SEC-15) — the promoted
    // member's existing session(s) are revoked; they re-authenticate to
    // pick up the new profile.
    await this.sessions.revokeAllForIdentity(updated.identityId, "promoted_to_administrator");
    return updated;
  }

  async getPendingOwnershipTransfer(organizationId: string) {
    return this.prisma.withContext({ organizationId }, async (tx) => {
      const proposal = await tx.ownershipTransferProposal.findFirst({
        where: { organizationId, status: "PENDING" },
      });
      if (!proposal) return null;

      const [proposer, successor] = await Promise.all([
        tx.membership.findUnique({
          where: { id: proposal.proposerMembershipId },
          select: { id: true, identity: { select: { displayEmail: true } } },
        }),
        tx.membership.findUnique({
          where: { id: proposal.successorMembershipId },
          select: { id: true, identity: { select: { displayEmail: true } } },
        }),
      ]);

      return { ...proposal, proposer, successor };
    });
  }

  async proposeOwnershipTransfer(actor: OrgActorContext, successorMembershipId: string, reason: string) {
    if (!actor.membership.isOwner) throw new ForbiddenException({ code: "organization_owner_required" });
    const correlationId = actor.correlationId ?? randomUUID();
    const expiresAt = new Date(Date.now() + OWNERSHIP_TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000);

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const successor = await tx.membership.findFirst({
        where: { id: successorMembershipId, organizationId: actor.organizationId },
      });
      if (!successor || successor.profile !== "ADMINISTRATOR" || successor.state !== "ACTIVE" || successor.isOwner) {
        throw new BadRequestException({ code: "successor_not_eligible" });
      }

      const existingPending = await tx.ownershipTransferProposal.findFirst({
        where: { organizationId: actor.organizationId, status: "PENDING" },
      });
      if (existingPending) throw new ConflictException({ code: "ownership_transfer_already_pending" });

      const proposal = await tx.ownershipTransferProposal.create({
        data: {
          organizationId: actor.organizationId,
          proposerMembershipId: actor.membership.id,
          successorMembershipId: successor.id,
          reason,
          expiresAt,
        },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "OWNERSHIP_TRANSFER_PROPOSED",
        reason,
        correlationId,
        after: { proposalId: proposal.id, successorMembershipId: successor.id },
      });

      return proposal;
    });
  }

  async cancelOwnershipTransfer(actor: OrgActorContext, proposalId: string, reason: string) {
    if (!actor.membership.isOwner) throw new ForbiddenException({ code: "organization_owner_required" });
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; proposer_membership_id: string }>>`
        SELECT id, status, proposer_membership_id FROM ownership_transfer_proposals
        WHERE id = ${proposalId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE
      `;
      const proposal = rows[0];
      if (!proposal || proposal.status !== "PENDING" || proposal.proposer_membership_id !== actor.membership.id) {
        throw new NotFoundException({ code: "ownership_transfer_proposal_not_found" });
      }

      await tx.ownershipTransferProposal.update({
        where: { id: proposal.id },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "OWNERSHIP_TRANSFER_CANCELLED",
        reason,
        correlationId,
      });

      return { ok: true };
    });
  }

  /**
   * The successor accepts. Rechecks proposer ownership, successor
   * eligibility, proposal freshness, and cancellation inside one serialized
   * transaction — the proposal row and both membership rows (proposer,
   * successor) are `FOR UPDATE` locked before being read, so a stale or
   * superseded proposal, a proposer who lost ownership, or a successor
   * concurrently suspended/removed at the same instant this is accepted
   * (test/integration/last-administrator-invariant.test.ts) cannot commit
   * — whichever transaction acquires each row's lock first wins, and the
   * loser re-reads post-conflict state and refuses cleanly.
   */
  async acceptOwnershipTransfer(actor: OrgActorContext, proposalId: string) {
    const correlationId = actor.correlationId ?? randomUUID();

    return this.prisma.withContext({ organizationId: actor.organizationId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: string; proposer_membership_id: string; successor_membership_id: string; expires_at: Date }>
      >`
        SELECT id, status, proposer_membership_id, successor_membership_id, expires_at
        FROM ownership_transfer_proposals
        WHERE id = ${proposalId}::uuid AND organization_id = ${actor.organizationId}::uuid FOR UPDATE
      `;
      const proposal = rows[0];
      if (!proposal || proposal.status !== "PENDING") {
        throw new NotFoundException({ code: "ownership_transfer_proposal_not_found" });
      }
      if (proposal.successor_membership_id !== actor.membership.id) {
        throw new ForbiddenException({ code: "not_the_proposed_successor" });
      }
      if (proposal.expires_at.getTime() <= Date.now()) {
        await tx.ownershipTransferProposal.update({ where: { id: proposal.id }, data: { status: "EXPIRED", resolvedAt: new Date() } });
        throw new NotFoundException({ code: "ownership_transfer_proposal_not_found" });
      }

      // Row-locked (always proposer then successor, to match the lock order
      // any other concurrent acceptOwnershipTransfer call would use, so two
      // racing accepts can never deadlock each other) — a plain read here
      // let a concurrent suspend/remove on the successor's membership commit
      // unseen, so this transaction would install a stale "still eligible"
      // successor as owner. Sequential, not Promise.all, so the locks are
      // actually acquired in that fixed order.
      await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${proposal.proposer_membership_id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${proposal.successor_membership_id}::uuid FOR UPDATE`;
      const [proposer, successor] = await Promise.all([
        tx.membership.findUnique({ where: { id: proposal.proposer_membership_id } }),
        tx.membership.findUnique({ where: { id: proposal.successor_membership_id } }),
      ]);
      if (!proposer?.isOwner || proposer.state !== "ACTIVE") {
        throw new BadRequestException({ code: "proposer_no_longer_owner" });
      }
      if (!successor || successor.profile !== "ADMINISTRATOR" || successor.state !== "ACTIVE") {
        throw new BadRequestException({ code: "successor_no_longer_eligible" });
      }

      // Old owner first, then new owner — required by the "at most one
      // active owner" unique index (both must never be true simultaneously).
      await tx.membership.update({ where: { id: proposer.id }, data: { isOwner: false, version: { increment: 1 } } });
      await tx.membership.update({ where: { id: successor.id }, data: { isOwner: true, version: { increment: 1 } } });
      await tx.ownershipTransferProposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED", resolvedAt: new Date() } });

      await this.evidence.record(tx, {
        organizationId: actor.organizationId,
        actorIdentityId: actor.membership.identityId,
        actorIsPlatformAdmin: false,
        action: "OWNERSHIP_TRANSFER_ACCEPTED",
        correlationId,
        before: { ownerMembershipId: proposer.id },
        after: { ownerMembershipId: successor.id },
      });

      return { formerOwnerMembershipId: proposer.id, newOwnerMembershipId: successor.id };
    });
  }
}
