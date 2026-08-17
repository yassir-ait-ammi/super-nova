/**
 * Deterministic synthetic seed data for at least two Organizations, used by
 * local dev and integration/E2E tests. Runs as nova_migrator (BYPASSRLS) —
 * see packages/db/src/tenant-context.ts for why that role, and only that
 * role, is allowed to bypass RLS.
 *
 * Re-running this script is safe: every row is upserted by a stable,
 * deterministic id derived from a fixed namespace, so seeding twice never
 * duplicates data.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/password";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.MIGRATOR_DATABASE_URL } },
});

// Fixed, readable UUIDs (v4-shaped but hand-assigned) so seed data is
// referenceable by name across tests without a lookup step.
const ids = {
  orgAcme: "a0000000-0000-4000-8000-000000000001",
  orgBeta: "b0000000-0000-4000-8000-000000000001",

  identityAcmeOwner: "a0000000-0000-4000-8000-000000000010",
  identityAcmeUser: "a0000000-0000-4000-8000-000000000011",
  identityBetaOwner: "b0000000-0000-4000-8000-000000000010",

  companyAcme: "a0000000-0000-4000-8000-000000000020",
  scopeAcme: "a0000000-0000-4000-8000-000000000030",

  companyBeta: "b0000000-0000-4000-8000-000000000020",
  scopeBeta: "b0000000-0000-4000-8000-000000000030",
};

// Synthetic-only credentials — never used outside local dev / CI fixtures.
const SEED_PASSWORD = "Correct-Harbor-Lighthouse-Beacon-9";

async function upsertIdentityWithPassword(id: string, email: string) {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await prisma.identity.upsert({
    where: { id },
    create: {
      id,
      normalizedEmail: email.toLowerCase(),
      displayEmail: email,
      passwordCredential: { create: { argon2Hash: passwordHash } },
    },
    update: {},
  });
}

async function seedOrganization(params: {
  orgId: string;
  name: string;
  ownerIdentityId: string;
  ownerEmail: string;
  companyId: string;
  companyName: string;
  scopeId: string;
  scopeName: string;
}) {
  const {
    orgId,
    name,
    ownerIdentityId,
    ownerEmail,
    companyId,
    companyName,
    scopeId,
    scopeName,
  } = params;

  await prisma.organization.upsert({
    where: { id: orgId },
    create: {
      id: orgId,
      name,
      normalizedName: name.toLowerCase(),
      accessStatus: "ACTIVE",
      commercialStatus: "PILOT",
      ownerContactEmail: ownerEmail,
    },
    update: {},
  });

  await upsertIdentityWithPassword(ownerIdentityId, ownerEmail);

  await prisma.membership.upsert({
    where: { organizationId_identityId: { organizationId: orgId, identityId: ownerIdentityId } },
    create: {
      organizationId: orgId,
      identityId: ownerIdentityId,
      profile: "ADMINISTRATOR",
      isOwner: true,
      state: "ACTIVE",
    },
    update: {},
  });

  await prisma.company.upsert({
    where: { id: companyId },
    create: {
      id: companyId,
      organizationId: orgId,
      name: companyName,
      normalizedName: companyName.toLowerCase(),
      status: "ACTIVE",
    },
    update: {},
  });

  await prisma.businessScope.upsert({
    where: { id: scopeId },
    create: {
      id: scopeId,
      organizationId: orgId,
      companyId,
      type: "RESTAURANT",
      name: scopeName,
      normalizedName: scopeName.toLowerCase(),
      status: "ACTIVE",
    },
    update: {},
  });
}

async function main() {
  await seedOrganization({
    orgId: ids.orgAcme,
    name: "Acme Bistro Group",
    ownerIdentityId: ids.identityAcmeOwner,
    ownerEmail: "owner@acme.nova-seed.test",
    companyId: ids.companyAcme,
    companyName: "Acme Bistro Group SAS",
    scopeId: ids.scopeAcme,
    scopeName: "Acme Downtown",
  });

  // A second collaborator in Acme, so permission/scope tests have a
  // non-owner active User to exercise from Slice 2 onward.
  await upsertIdentityWithPassword(ids.identityAcmeUser, "user@acme.nova-seed.test");
  await prisma.membership.upsert({
    where: {
      organizationId_identityId: { organizationId: ids.orgAcme, identityId: ids.identityAcmeUser },
    },
    create: {
      organizationId: ids.orgAcme,
      identityId: ids.identityAcmeUser,
      profile: "USER",
      isOwner: false,
      state: "ACTIVE",
    },
    update: {},
  });

  await seedOrganization({
    orgId: ids.orgBeta,
    name: "Beta Construction Co",
    ownerIdentityId: ids.identityBetaOwner,
    ownerEmail: "owner@beta.nova-seed.test",
    companyId: ids.companyBeta,
    companyName: "Beta Construction Co Ltd",
    scopeId: ids.scopeBeta,
    scopeName: "Beta Site One",
  });

  console.log("[seed] Two Organizations ready: Acme Bistro Group, Beta Construction Co");
  console.log(`[seed] Synthetic password for all seeded identities: ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
