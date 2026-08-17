import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed, createPlatformAdmin, createOrganization, loginAs, uniqueSuffix } from "./helpers/fixtures";
import { createTestApp } from "./helpers/test-app";

const ADMIN_PASSWORD = "Correct-Harbor-Lighthouse-Beacon-9";
const MEMBER_PASSWORD = "Member-Chooses-This-Password-000";

describe("Organization lifecycle and immediate revocation", () => {
  let app: INestApplication;
  let adminSession: Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    app = await createTestApp();
    const adminEmail = `platform-admin-${uniqueSuffix()}@nova-test.local`;
    await createPlatformAdmin(app, adminEmail, ADMIN_PASSWORD);
    adminSession = await loginAs(app, adminEmail, ADMIN_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("FR-004: suspend -> reactivate is a valid round trip with evidence recorded", async () => {
    const org = await createOrganization(app, { name: `Lifecycle Org ${uniqueSuffix()}` });

    const suspend = await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/suspend`)
      .send({ reason: "billing dispute under review" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.accessStatus).toBe("SUSPENDED");

    const reactivate = await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/reactivate`)
      .send({ reason: "dispute resolved" });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.accessStatus).toBe("ACTIVE");

    const prisma = app.get(PrismaService);
    const evidence = await prisma.withContext({ isPlatformAdmin: true, organizationId: org.id }, (tx) =>
      tx.adminEvidence.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } })
    );
    expect(evidence.map((e) => e.action)).toEqual(["ORGANIZATION_SUSPENDED", "ORGANIZATION_REACTIVATED"]);
    expect(evidence.every((e) => typeof e.reason === "string" && e.reason.length > 0)).toBe(true);
  });

  it("rejects an invalid transition (cannot reactivate an Organization that isn't suspended)", async () => {
    const org = await createOrganization(app, { name: `Invalid Transition Org ${uniqueSuffix()}` });
    const res = await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/reactivate`)
      .send({ reason: "no-op attempt" });
    expect(res.status).toBe(400);
  });

  it("terminal disablement has no reactivation path", async () => {
    const org = await createOrganization(app, { name: `Terminal Org ${uniqueSuffix()}` });
    await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/disable`)
      .send({ reason: "fraud confirmed" })
      .expect(200);

    const reactivateAttempt = await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/reactivate`)
      .send({ reason: "attempted reversal" });
    expect(reactivateAttempt.status).toBe(400);

    const suspendAttempt = await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/suspend`)
      .send({ reason: "attempted reversal" });
    expect(suspendAttempt.status).toBe(400);
  });

  it("SEC-07: suspending an Organization immediately revokes its members' open sessions", async () => {
    const ownerEmail = `owner-${uniqueSuffix()}@nova-test.local`;
    const createRes = await authed(app, adminSession)
      .post("/api/platform-admin/organizations")
      .send({ name: `Revocation Org ${uniqueSuffix()}`, ownerEmail });
    const organizationId = createRes.body.id;

    const emailRes = await request(app.getHttpServer()).get(
      `/api/test-support/emails/latest?to=${encodeURIComponent(ownerEmail)}`
    );
    const token = decodeURIComponent(emailRes.body.text.match(/token=([^\s&"']+)/)[1]);
    await request(app.getHttpServer()).post("/api/invitations/accept").send({ token, password: MEMBER_PASSWORD }).expect(200);

    const ownerSession = await loginAs(app, ownerEmail, MEMBER_PASSWORD);
    const meBefore = await authed(app, ownerSession).get("/api/auth/me");
    expect(meBefore.status).toBe(200);

    await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${organizationId}/suspend`)
      .send({ reason: "immediate revocation test" })
      .expect(200);

    const meAfter = await authed(app, ownerSession).get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("FR-006: commercial status is independent of access status", async () => {
    const org = await createOrganization(app, { name: `Commercial Org ${uniqueSuffix()}` });
    await authed(app, adminSession)
      .post(`/api/platform-admin/organizations/${org.id}/suspend`)
      .send({ reason: "access suspended for unrelated reason" })
      .expect(200);

    const res = await authed(app, adminSession)
      .patch(`/api/platform-admin/organizations/${org.id}/commercial-status`)
      .send({ commercialStatus: "ACTIVE", reason: "contract signed" });
    expect(res.status).toBe(200);
    expect(res.body.commercialStatus).toBe("ACTIVE");
    expect(res.body.accessStatus).toBe("SUSPENDED");
  });

  it("SEC-02: the browser-supplied Organization id in the URL is authoritative only after server-side authorization — a non-platform-admin gets a neutral refusal", async () => {
    const org = await createOrganization(app, { name: `Direct API Org ${uniqueSuffix()}` });
    const res = await request(app.getHttpServer())
      .post(`/api/platform-admin/organizations/${org.id}/suspend`)
      .send({ reason: "unauthenticated attempt" });
    expect(res.status).toBe(401);
  });
});
