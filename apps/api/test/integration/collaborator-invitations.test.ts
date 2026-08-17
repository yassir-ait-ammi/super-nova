import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed, loginAs, uniqueSuffix } from "./helpers/fixtures";
import { setupOrgWithOwner } from "./helpers/org-fixtures";
import { createTestApp } from "./helpers/test-app";

const COLLABORATOR_PASSWORD = "Collaborator-Chosen-Password-00";

async function recordedToken(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).get(`/api/test-support/emails/latest?to=${encodeURIComponent(email)}`);
  expect(res.status).toBe(200);
  const match = (res.body.text as string).match(/token=([^\s&"']+)/);
  if (!match?.[1]) throw new Error("no token in recorded email");
  return decodeURIComponent(match[1]);
}

describe("Collaborator invitation lifecycle", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("FR-089: an Administrator invites a User with explicit capabilities and scope; acceptance applies exactly those grants", async () => {
    const org = await setupOrgWithOwner(app, "Invite Org");
    const companyRes = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: `Invite Co ${uniqueSuffix()}` });
    const companyId = companyRes.body.id;

    const email = `collaborator-${uniqueSuffix()}@nova-test.local`;
    const invite = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations`)
      .send({
        email,
        presetKey: "COMPANY_MANAGER",
        capabilities: ["VIEW_COMPANIES", "MANAGE_COMPANIES"],
        scopeGrants: [{ companyId }],
      });
    expect(invite.status).toBe(201);

    const token = await recordedToken(app, email);
    const accept = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token, password: COLLABORATOR_PASSWORD });
    expect(accept.status).toBe(200);

    const prisma = app.get(PrismaService);
    const membership = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findFirst({
        where: { organizationId: org.organizationId, identity: { normalizedEmail: email } },
        include: { capabilities: true, scopeGrants: true },
      })
    );
    expect(membership?.profile).toBe("USER");
    expect(membership?.isOwner).toBe(false);
    expect(membership?.capabilities.map((c) => c.capability).sort()).toEqual(["MANAGE_COMPANIES", "VIEW_COMPANIES"]);
    expect(membership?.scopeGrants).toHaveLength(1);
    expect(membership?.scopeGrants[0]?.companyId).toBe(companyId);

    // The new collaborator can now see exactly the granted company.
    const collaboratorSession = await loginAs(app, email, COLLABORATOR_PASSWORD);
    const list = await authed(app, collaboratorSession).get(`/api/organizations/${org.organizationId}/companies`);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([companyId]);
  });

  it("SEC-13: an identity already belonging to another Organization cannot accept a second Organization's invitation", async () => {
    const orgA = await setupOrgWithOwner(app, "Org A Membership");
    const orgB = await setupOrgWithOwner(app, "Org B Membership");

    const email = `dual-${uniqueSuffix()}@nova-test.local`;
    await authed(app, orgA.ownerSession)
      .post(`/api/organizations/${orgA.organizationId}/invitations`)
      .send({ email, capabilities: [], scopeGrants: [] })
      .expect(201);
    const tokenA = await recordedToken(app, email);
    await request(app.getHttpServer()).post("/api/invitations/accept").send({ token: tokenA, password: COLLABORATOR_PASSWORD }).expect(200);

    await authed(app, orgB.ownerSession)
      .post(`/api/organizations/${orgB.organizationId}/invitations`)
      .send({ email, capabilities: [], scopeGrants: [] })
      .expect(201);
    const tokenB = await recordedToken(app, email);
    const secondAccept = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token: tokenB, password: "Different-Password-000000000" });
    expect(secondAccept.status).toBe(409);
    expect(secondAccept.body.code).toBe("invitation_requires_login");
  });

  it("SEC-13: re-inviting the same email within the same Organization reuses the membership record, not a duplicate", async () => {
    const org = await setupOrgWithOwner(app, "Reinvite Org");
    const email = `reinvite-${uniqueSuffix()}@nova-test.local`;

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations`)
      .send({ email, capabilities: [], scopeGrants: [] })
      .expect(201);
    const token1 = await recordedToken(app, email);
    await request(app.getHttpServer()).post("/api/invitations/accept").send({ token: token1, password: COLLABORATOR_PASSWORD }).expect(200);

    const prisma = app.get(PrismaService);
    const membershipsBefore = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findMany({ where: { organizationId: org.organizationId, identity: { normalizedEmail: email } } })
    );
    expect(membershipsBefore).toHaveLength(1);

    // Suspend, then re-invite (simulating a lapsed collaborator being brought back).
    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/members/${membershipsBefore[0]!.id}/suspend`)
      .send({ reason: "temporary leave" })
      .expect(200);

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations`)
      .send({ email, capabilities: ["VIEW_COMPANIES"], scopeGrants: [] })
      .expect(201);

    const membershipsAfter = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findMany({ where: { organizationId: org.organizationId, identity: { normalizedEmail: email } } })
    );
    expect(membershipsAfter).toHaveLength(1);
    expect(membershipsAfter[0]!.id).toBe(membershipsBefore[0]!.id);
  });

  it("resend invalidates the previous token; revoke prevents acceptance", async () => {
    const org = await setupOrgWithOwner(app, "Resend Org");
    const email = `resend-${uniqueSuffix()}@nova-test.local`;
    const first = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations`)
      .send({ email, capabilities: [], scopeGrants: [] });
    const listBefore = await authed(app, org.ownerSession).get(`/api/organizations/${org.organizationId}/invitations`);
    const invitationId = listBefore.body[0].id;
    const oldToken = await recordedToken(app, email);
    void first;

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations/${invitationId}/resend`)
      .send({})
      .expect(200);

    const staleAccept = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token: oldToken, password: COLLABORATOR_PASSWORD });
    expect(staleAccept.status).toBe(404);

    const newToken = await recordedToken(app, email);
    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/invitations/${invitationId}/revoke`)
      .send({ reason: "invited by mistake" })
      .expect(200);

    const revokedAccept = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token: newToken, password: COLLABORATOR_PASSWORD });
    expect(revokedAccept.status).toBe(404);
  });
});
