import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { generateOpaqueSecret, hashPassword, hashSecret, type Prisma } from "@nova/db";
import { INVITATION_TTL_DAYS, normalizeEmail } from "@nova/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EvidenceService } from "../evidence/evidence.service";
import { OutboxService } from "../email/outbox.service";
import { EmailDispatcherService } from "../email/email-dispatcher.service";
import { PasswordPolicyService } from "../identity/password-policy.service";
import type { ScopeGrantInput } from "./membership.service";

export interface CreateInitialOwnerInvitationParams {
  organizationId: string;
  organizationName: string;
  ownerEmail: string;
  actorPlatformAdminIdentityId: string;
  correlationId: string;
}

export interface CreateCollaboratorInvitationParams {
  organizationId: string;
  organizationName: string;
  inviterMembershipId: string;
  inviterIdentityId: string;
  inviterLabel: string;
  email: string;
  presetKey?: string;
  capabilities: string[];
  scopeGrants: ScopeGrantInput[];
  correlationId?: string;
}

export interface AcceptedInvitation {
  identityId: string;
  organizationId: string;
  organizationActivated: boolean;
}

/** "This email is already tied to an account" — safe to state, since the bearer already possesses the invited address. */
export class InvitationRequiresLoginError extends ConflictException {
  constructor() {
    super({ code: "invitation_requires_login" });
  }
}

interface PendingGrants {
  capabilities?: string[];
  scopeGrants?: ScopeGrantInput[];
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: EmailDispatcherService,
    private readonly evidence: EvidenceService,
    private readonly passwordPolicy: PasswordPolicyService
  ) {}

  /**
   * Creates (or, if one is already PENDING for this Organization+email,
   * replaces) the initial-owner invitation, and atomically enqueues its
   * email (SEC-11). The org id is always the server-resolved row being
   * provisioned — never client input.
   */
  async createInitialOwnerInvitation(params: CreateInitialOwnerInvitationParams): Promise<{ invitationId: string }> {
    const { invitationId, outboxId } = await this.prisma.withContext(
      { organizationId: params.organizationId, isPlatformAdmin: true },
      (tx) =>
        this.createOrReplaceInvitation(tx, {
          organizationId: params.organizationId,
          kind: "INITIAL_OWNER",
          email: params.ownerEmail,
          initialProfile: "ADMINISTRATOR",
          createdByActorLabel: "platform_administrator",
          templateKey: "INITIAL_OWNER_INVITE",
          templateVariables: { organizationName: params.organizationName },
          actorIdentityId: params.actorPlatformAdminIdentityId,
          actorIsPlatformAdmin: true,
          correlationId: params.correlationId,
        })
    );

    await this.dispatchAfterCommit(outboxId, "initial-owner invite");
    return { invitationId };
  }

  /** Issued by an Organization Administrator, never a Platform Administrator. Initially targets `User` (FR-089). */
  async createCollaboratorInvitation(params: CreateCollaboratorInvitationParams): Promise<{ invitationId: string }> {
    const { invitationId, outboxId } = await this.prisma.withContext(
      { organizationId: params.organizationId },
      (tx) =>
        this.createOrReplaceInvitation(tx, {
          organizationId: params.organizationId,
          kind: "COLLABORATOR",
          email: params.email,
          initialProfile: "USER",
          createdByActorLabel: params.inviterMembershipId,
          templateKey: "COLLABORATOR_INVITE",
          templateVariables: { organizationName: params.organizationName, inviterLabel: params.inviterLabel },
          actorIdentityId: params.inviterIdentityId,
          actorIsPlatformAdmin: false,
          correlationId: params.correlationId,
          pendingGrants: { capabilities: params.capabilities, scopeGrants: params.scopeGrants },
          presetKey: params.presetKey,
        })
    );

    await this.dispatchAfterCommit(outboxId, "collaborator invite");
    return { invitationId };
  }

  async resendInvitation(organizationId: string, actorIdentityId: string, invitationId: string, correlationId?: string) {
    const { outboxId } = await this.prisma.withContext({ organizationId }, async (tx) => {
      const existing = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId, status: "PENDING", kind: "COLLABORATOR" },
      });
      if (!existing) throw new NotFoundException({ code: "invitation_not_found" });

      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const grants = (existing.pendingGrants as PendingGrants | null) ?? {};

      return this.createOrReplaceInvitation(tx, {
        organizationId,
        kind: "COLLABORATOR",
        email: existing.normalizedEmail,
        initialProfile: "USER",
        createdByActorLabel: existing.createdByActorLabel,
        templateKey: "COLLABORATOR_INVITE",
        templateVariables: { organizationName: organization.name, inviterLabel: "an Organization Administrator" },
        actorIdentityId,
        actorIsPlatformAdmin: false,
        correlationId,
        pendingGrants: { capabilities: grants.capabilities ?? [], scopeGrants: grants.scopeGrants ?? [] },
        presetKey: existing.presetKey ?? undefined,
      });
    });

    await this.dispatchAfterCommit(outboxId, "collaborator invite resend");
    return { ok: true };
  }

  async revokeInvitation(organizationId: string, actorIdentityId: string, invitationId: string, reason: string) {
    return this.prisma.withContext({ organizationId }, async (tx) => {
      const existing = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId, status: "PENDING" },
      });
      if (!existing) throw new NotFoundException({ code: "invitation_not_found" });

      await tx.invitation.update({ where: { id: existing.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      await this.evidence.record(tx, {
        organizationId,
        actorIdentityId,
        actorIsPlatformAdmin: false,
        action: "INVITATION_REVOKED",
        reason,
        after: { invitationId: existing.id },
      });

      return { ok: true };
    });
  }

  async listInvitations(organizationId: string) {
    return this.prisma.withContext({ organizationId }, (tx) =>
      tx.invitation.findMany({
        where: { organizationId, kind: "COLLABORATOR" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          normalizedEmail: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          presetKey: true,
        },
      })
    );
  }

  private async createOrReplaceInvitation(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      kind: "INITIAL_OWNER" | "COLLABORATOR";
      email: string;
      initialProfile: "ADMINISTRATOR" | "USER";
      createdByActorLabel: string;
      templateKey: "INITIAL_OWNER_INVITE" | "COLLABORATOR_INVITE";
      templateVariables: Record<string, string>;
      actorIdentityId: string;
      actorIsPlatformAdmin: boolean;
      correlationId?: string;
      pendingGrants?: PendingGrants;
      presetKey?: string;
    }
  ): Promise<{ invitationId: string; outboxId: string }> {
    const normalizedEmailValue = normalizeEmail(params.email);
    const token = generateOpaqueSecret();
    const tokenHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const existing = await tx.invitation.findFirst({
      where: { organizationId: params.organizationId, normalizedEmail: normalizedEmailValue, status: "PENDING" },
    });

    const invitation = existing
      ? await tx.invitation.update({
          where: { id: existing.id },
          data: {
            tokenHash,
            expiresAt,
            version: { increment: 1 },
            pendingGrants: (params.pendingGrants as Prisma.InputJsonValue) ?? undefined,
            presetKey: params.presetKey,
          },
        })
      : await tx.invitation.create({
          data: {
            organizationId: params.organizationId,
            kind: params.kind,
            normalizedEmail: normalizedEmailValue,
            tokenHash,
            expiresAt,
            initialProfile: params.initialProfile,
            createdByActorLabel: params.createdByActorLabel,
            pendingGrants: (params.pendingGrants as Prisma.InputJsonValue) ?? undefined,
            presetKey: params.presetKey,
          },
        });

    const { outboxId } = await this.outbox.enqueue(tx, {
      organizationId: params.organizationId,
      templateKey: params.templateKey,
      recipientEmail: params.email,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variables: { ...params.templateVariables, expiresAt: expiresAt.toISOString() } as any,
      secretToken: token,
    });

    await this.evidence.record(tx, {
      organizationId: params.organizationId,
      actorIdentityId: params.actorIdentityId,
      actorIsPlatformAdmin: params.actorIsPlatformAdmin,
      action: existing
        ? `${params.kind}_INVITATION_RESENT`
        : `${params.kind}_INVITATION_SENT`,
      correlationId: params.correlationId,
      after: { invitationId: invitation.id, normalizedEmail: normalizedEmailValue },
    });

    return { invitationId: invitation.id, outboxId };
  }

  private async dispatchAfterCommit(outboxId: string, label: string): Promise<void> {
    // Synchronous send-after-commit (architecture section 6). If this
    // throws, the row stays PENDING and a later dispatchAllPending() sweep
    // retries it — the invitation itself is already durably committed.
    await this.dispatcher
      .dispatchOne(outboxId)
      .catch((error) => this.logger.warn(`${label} dispatch deferred: ${error?.message ?? error}`));
  }

  /** Filters a proposed grant set down to Companies/Business Scopes that are still active in this Organization. */
  private async filterLiveGrants(
    tx: Prisma.TransactionClient,
    organizationId: string,
    grants: ScopeGrantInput[]
  ): Promise<ScopeGrantInput[]> {
    if (grants.length === 0) return [];
    const companyIds = grants.map((g) => g.companyId).filter((v): v is string => Boolean(v));
    const scopeIds = grants.map((g) => g.businessScopeId).filter((v): v is string => Boolean(v));

    const [liveCompanies, liveScopes] = await Promise.all([
      companyIds.length
        ? tx.company.findMany({ where: { id: { in: companyIds }, organizationId, status: "ACTIVE" }, select: { id: true } })
        : Promise.resolve([]),
      scopeIds.length
        ? tx.businessScope.findMany({ where: { id: { in: scopeIds }, organizationId, status: "ACTIVE" }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    const liveCompanyIds = new Set(liveCompanies.map((c) => c.id));
    const liveScopeIds = new Set(liveScopes.map((s) => s.id));

    return grants.filter(
      (g) => (g.companyId && liveCompanyIds.has(g.companyId)) || (g.businessScopeId && liveScopeIds.has(g.businessScopeId))
    );
  }

  /**
   * Accepts an invitation for a brand-new identity (no prior account): sets
   * a compliant password atomically with membership creation, and — for an
   * INITIAL_OWNER invitation — activates the Organization in the same
   * transaction (SEC-09). Concurrency-safe: the invitation row is locked
   * (`FOR UPDATE`) before any state is read, so two concurrent accepts of
   * the same token can never both succeed.
   */
  async acceptForNewIdentity(rawToken: string, password: string): Promise<AcceptedInvitation> {
    const passwordCheck = this.passwordPolicy.evaluate(password);
    if (!passwordCheck.ok) {
      throw new BadRequestException({ code: `password_${passwordCheck.reason}` });
    }

    return this.acceptCore(rawToken, async (tx, invitation) => {
      const existingIdentity = await tx.identity.findUnique({
        where: { normalizedEmail: invitation.normalized_email },
      });
      if (existingIdentity) {
        throw new InvitationRequiresLoginError();
      }

      const argon2Hash = await hashPassword(password);
      const identity = await tx.identity.create({
        data: {
          normalizedEmail: invitation.normalized_email,
          displayEmail: invitation.normalized_email,
          passwordCredential: { create: { argon2Hash } },
        },
      });
      return identity.id;
    });
  }

  /**
   * Accepts a collaborator invitation for an identity that already
   * authenticated (SEC-09: "an existing identity authenticates first and
   * must have the same normalized email"). `callerIdentityId`/
   * `callerNormalizedEmail` come only from the authenticated session, never
   * from request input.
   */
  async acceptForExistingIdentity(
    rawToken: string,
    callerIdentityId: string,
    callerNormalizedEmail: string
  ): Promise<AcceptedInvitation> {
    return this.acceptCore(rawToken, async (_tx, invitation) => {
      if (invitation.normalized_email !== callerNormalizedEmail) {
        throw new InvitationRequiresLoginError();
      }
      return callerIdentityId;
    });
  }

  private async acceptCore(
    rawToken: string,
    resolveIdentityId: (
      tx: Prisma.TransactionClient,
      invitation: {
        id: string;
        organization_id: string;
        kind: string;
        normalized_email: string;
        status: string;
        expires_at: Date;
        initial_profile: string;
        pending_grants: PendingGrants | null;
      }
    ) => Promise<string>
  ): Promise<AcceptedInvitation> {
    const tokenHash = hashSecret(rawToken);

    return this.prisma.withContext({ isSystem: true }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          organization_id: string;
          kind: string;
          normalized_email: string;
          status: string;
          expires_at: Date;
          initial_profile: string;
          pending_grants: PendingGrants | null;
        }>
      >`SELECT id, organization_id, kind, normalized_email, status, expires_at, initial_profile, pending_grants
        FROM invitations WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const invitation = rows[0];

      if (!invitation) throw new NotFoundException({ code: "invalid_or_expired_invitation" });

      // From here on this transaction is scoped to the invitation's
      // Organization — set before any write (including the expiry-marking
      // update below) so every subsequent statement satisfies the ordinary
      // per-Organization RLS check rather than needing a broader carve-out.
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${invitation.organization_id}'`);

      if (invitation.status !== "PENDING") {
        throw new NotFoundException({ code: "invalid_or_expired_invitation" });
      }
      if (invitation.expires_at.getTime() <= Date.now()) {
        await tx.$executeRaw`UPDATE invitations SET status = 'EXPIRED' WHERE id = ${invitation.id}::uuid`;
        throw new NotFoundException({ code: "invalid_or_expired_invitation" });
      }

      const identityId = await resolveIdentityId(tx, invitation);

      // SEC-13: one customer Organization membership. A former membership in
      // the SAME Organization is reused (never duplicated); a membership
      // already attached to ANOTHER Organization is rejected neutrally.
      const anyExistingMembership = await tx.membership.findFirst({ where: { identityId } });
      if (anyExistingMembership && anyExistingMembership.organizationId !== invitation.organization_id) {
        throw new InvitationRequiresLoginError();
      }

      if (anyExistingMembership) {
        await tx.membership.update({
          where: { id: anyExistingMembership.id },
          data: {
            profile: invitation.initial_profile as Prisma.MembershipCreateInput["profile"],
            state: "ACTIVE",
            version: { increment: 1 },
          },
        });
      } else {
        await tx.membership.create({
          data: {
            organizationId: invitation.organization_id,
            identityId,
            profile: invitation.initial_profile as Prisma.MembershipCreateInput["profile"],
            isOwner: invitation.kind === "INITIAL_OWNER",
            state: "ACTIVE",
          },
        });
      }

      const membership = await tx.membership.findFirstOrThrow({
        where: { organizationId: invitation.organization_id, identityId },
      });

      // Acceptance recalculates current capabilities/scopes and never
      // resurrects removed or inactive grants — apply only what's still
      // live, and always replace rather than merge with any stale prior grants.
      await tx.membershipCapability.deleteMany({ where: { membershipId: membership.id } });
      await tx.membershipScopeGrant.deleteMany({ where: { membershipId: membership.id } });
      if (invitation.kind === "COLLABORATOR" && invitation.pending_grants) {
        const grants = invitation.pending_grants;
        const liveScopeGrants = await this.filterLiveGrants(tx, invitation.organization_id, grants.scopeGrants ?? []);
        if (grants.capabilities && grants.capabilities.length > 0) {
          await tx.membershipCapability.createMany({
            data: grants.capabilities.map((capability) => ({
              organizationId: invitation.organization_id,
              membershipId: membership.id,
              capability,
            })),
          });
        }
        if (liveScopeGrants.length > 0) {
          await tx.membershipScopeGrant.createMany({
            data: liveScopeGrants.map((g) => ({
              organizationId: invitation.organization_id,
              membershipId: membership.id,
              companyId: g.companyId ?? null,
              businessScopeId: g.businessScopeId ?? null,
            })),
          });
        }
      }

      await tx.$executeRaw`UPDATE invitations SET status = 'ACCEPTED', accepted_at = now(), accepted_by_identity_id = ${identityId}::uuid WHERE id = ${invitation.id}::uuid`;

      let organizationActivated = false;
      if (invitation.kind === "INITIAL_OWNER") {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: invitation.organization_id } });
        if (org.accessStatus === "PROVISIONING") {
          await tx.organization.update({
            where: { id: invitation.organization_id },
            data: { accessStatus: "ACTIVE" },
          });
          organizationActivated = true;
          await this.evidence.record(tx, {
            organizationId: invitation.organization_id,
            actorIdentityId: identityId,
            actorIsPlatformAdmin: false,
            action: "ORGANIZATION_ACTIVATED",
            before: { accessStatus: "PROVISIONING" },
            after: { accessStatus: "ACTIVE" },
          });
        }
      }

      return {
        identityId,
        organizationId: invitation.organization_id,
        organizationActivated,
      };
    });
  }
}
