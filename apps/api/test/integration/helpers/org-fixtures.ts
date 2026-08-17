import type { INestApplication } from "@nestjs/common";
import { hashPassword } from "@nova/db";
import { PrismaService } from "../../../src/prisma/prisma.service";
import { loginAs, uniqueSuffix, type AuthedSession } from "./fixtures";

const PASSWORD = "Correct-Harbor-Lighthouse-Beacon-9";

export interface OrgWithOwner {
  organizationId: string;
  ownerMembershipId: string;
  ownerIdentityId: string;
  ownerEmail: string;
  ownerSession: AuthedSession;
}

/** Bypasses the invitation flow for test setup speed — the invitation/accept journey itself is covered separately. */
export async function setupOrgWithOwner(app: INestApplication, namePrefix = "Org"): Promise<OrgWithOwner> {
  const prisma = app.get(PrismaService);
  const suffix = uniqueSuffix();
  const name = `${namePrefix} ${suffix}`;
  const ownerEmail = `owner-${suffix}@nova-test.local`;
  const argon2Hash = await hashPassword(PASSWORD);

  const { organizationId, ownerMembershipId, ownerIdentityId } = await prisma.withContext(
    { isPlatformAdmin: true },
    async (tx) => {
      const org = await tx.organization.create({
        data: { name, normalizedName: name.toLowerCase(), accessStatus: "ACTIVE", commercialStatus: "PILOT" },
      });
      const identity = await tx.identity.create({
        data: {
          normalizedEmail: ownerEmail,
          displayEmail: ownerEmail,
          passwordCredential: { create: { argon2Hash } },
        },
      });
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${org.id}'`);
      const membership = await tx.membership.create({
        data: { organizationId: org.id, identityId: identity.id, profile: "ADMINISTRATOR", isOwner: true, state: "ACTIVE" },
      });
      return { organizationId: org.id, ownerMembershipId: membership.id, ownerIdentityId: identity.id };
    }
  );

  const ownerSession = await loginAs(app, ownerEmail, PASSWORD);
  return { organizationId, ownerMembershipId, ownerIdentityId, ownerEmail, ownerSession };
}

export async function addActiveAdministrator(app: INestApplication, organizationId: string) {
  const prisma = app.get(PrismaService);
  const suffix = uniqueSuffix();
  const email = `admin-${suffix}@nova-test.local`;
  const argon2Hash = await hashPassword(PASSWORD);

  const membershipId = await prisma.withContext({ organizationId }, async (tx) => {
    const identity = await tx.identity.create({
      data: { normalizedEmail: email, displayEmail: email, passwordCredential: { create: { argon2Hash } } },
    });
    const membership = await tx.membership.create({
      data: { organizationId, identityId: identity.id, profile: "ADMINISTRATOR", isOwner: false, state: "ACTIVE" },
    });
    return membership.id;
  });

  const session = await loginAs(app, email, PASSWORD);
  return { membershipId, email, session };
}

export async function addActiveUser(app: INestApplication, organizationId: string, capabilities: string[] = []) {
  const prisma = app.get(PrismaService);
  const suffix = uniqueSuffix();
  const email = `user-${suffix}@nova-test.local`;
  const argon2Hash = await hashPassword(PASSWORD);

  const membershipId = await prisma.withContext({ organizationId }, async (tx) => {
    const identity = await tx.identity.create({
      data: { normalizedEmail: email, displayEmail: email, passwordCredential: { create: { argon2Hash } } },
    });
    const membership = await tx.membership.create({
      data: { organizationId, identityId: identity.id, profile: "USER", isOwner: false, state: "ACTIVE" },
    });
    if (capabilities.length > 0) {
      await tx.membershipCapability.createMany({
        data: capabilities.map((capability) => ({ organizationId, membershipId: membership.id, capability })),
      });
    }
    return membership.id;
  });

  const session = await loginAs(app, email, PASSWORD);
  return { membershipId, email, session };
}

export { PASSWORD as FIXTURE_PASSWORD };
