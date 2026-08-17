import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@nova/db";
import { normalizeEmail } from "@nova/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EvidenceService } from "../evidence/evidence.service";
import { PasswordPolicyService } from "./password-policy.service";
import { RequestMeta, SessionService } from "./session.service";

export interface RegisterResult {
  identityId: string;
  organizationId: string;
  organizationName: string;
  session: Awaited<ReturnType<SessionService["create"]>>;
}

/**
 * Self-service sign-up: unlike every other Organization-creation path in
 * this app (Platform Administrator provisioning, collaborator invitation),
 * this one has no inviter — a brand-new Identity creates a brand-new
 * Organization and becomes its owner/Administrator in one request, with no
 * PROVISIONING step and no invitation email, then is signed in immediately.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly evidence: EvidenceService,
    private readonly passwordPolicy: PasswordPolicyService
  ) {}

  async register(
    params: { organizationName: string; email: string; password: string },
    meta: RequestMeta
  ): Promise<RegisterResult> {
    const passwordCheck = this.passwordPolicy.evaluate(params.password);
    if (!passwordCheck.ok) {
      throw new BadRequestException({ code: `password_${passwordCheck.reason}` });
    }

    const normalizedEmailValue = normalizeEmail(params.email);
    const normalizedOrgName = params.organizationName.trim().toLowerCase();
    const correlationId = randomUUID();

    // Cheap up-front checks (real UX for a sign-up form — unlike login,
    // revealing "that email/name is taken" here isn't an enumeration risk:
    // the caller is choosing an identity to create, not probing one that
    // might already exist). The transaction below re-checks both under
    // lock-free uniqueness constraints as the authoritative guard.
    const existingIdentity = await this.prisma.client.identity.findUnique({
      where: { normalizedEmail: normalizedEmailValue },
    });
    if (existingIdentity) {
      throw new ConflictException({ code: "email_already_registered" });
    }

    const argon2Hash = await hashPassword(params.password);

    const { identityId, organizationId, organizationName } = await this.prisma.withContext(
      // organizations_insert's RLS policy requires an authenticated
      // Platform Administrator context (only that role is trusted to
      // create a tenant root elsewhere in this app). Self-registration is
      // the one exception: a trusted, server-side-only code path — this
      // flag is never derived from request input and grants no other
      // platform-admin capability to the new identity — mirroring how
      // `app.is_system` is used for invitation acceptance below.
      { isPlatformAdmin: true },
      async (tx) => {
        const existingOrg = await tx.organization.findFirst({ where: { normalizedName: normalizedOrgName } });
        if (existingOrg) {
          throw new ConflictException({ code: "organization_name_taken" });
        }

        const identity = await tx.identity.create({
          data: {
            normalizedEmail: normalizedEmailValue,
            displayEmail: params.email.trim(),
            passwordCredential: { create: { argon2Hash } },
          },
        });

        const organization = await tx.organization.create({
          data: {
            name: params.organizationName.trim(),
            normalizedName: normalizedOrgName,
            accessStatus: "ACTIVE",
            commercialStatus: "DEMO",
            ownerContactEmail: params.email.trim(),
          },
        });

        await this.evidence.record(tx, {
          organizationId: organization.id,
          actorIdentityId: identity.id,
          actorIsPlatformAdmin: false,
          action: "ORGANIZATION_SELF_REGISTERED",
          correlationId,
          after: { accessStatus: "ACTIVE", name: organization.name },
        });

        // The Organization id wasn't known until just above, so — mirroring
        // invitations.service.ts's acceptCore — scope the rest of this same
        // transaction to it before writing the owner Membership row, which
        // memberships_insert's RLS policy requires to match app.org_id.
        await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${organization.id}'`);

        await tx.membership.create({
          data: {
            organizationId: organization.id,
            identityId: identity.id,
            profile: "ADMINISTRATOR",
            isOwner: true,
            state: "ACTIVE",
          },
        });

        await this.evidence.record(tx, {
          organizationId: organization.id,
          actorIdentityId: identity.id,
          actorIsPlatformAdmin: false,
          action: "OWNER_MEMBERSHIP_CREATED",
          correlationId,
          after: { profile: "ADMINISTRATOR", isOwner: true },
        });

        return { identityId: identity.id, organizationId: organization.id, organizationName: organization.name };
      }
    );

    const session = await this.sessions.create(identityId, meta);

    return { identityId, organizationId, organizationName, session };
  }
}
