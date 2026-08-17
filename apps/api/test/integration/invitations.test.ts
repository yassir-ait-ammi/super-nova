import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed, createPlatformAdmin, loginAs, uniqueSuffix } from "./helpers/fixtures";
import { createTestApp } from "./helpers/test-app";

const ADMIN_PASSWORD = "Correct-Harbor-Lighthouse-Beacon-9";
const OWNER_PASSWORD = "Owner-Chooses-This-Password-000";

function extractToken(text: string): string {
  const match = text.match(/token=([^\s&"']+)/);
  const captured = match?.[1];
  if (!captured) throw new Error(`no token found in recorded email: ${text}`);
  return decodeURIComponent(captured);
}

async function recordedLinkFor(app: INestApplication, email: string): Promise<{ token: string }> {
  const res = await request(app.getHttpServer()).get(`/api/test-support/emails/latest?to=${encodeURIComponent(email)}`);
  expect(res.status).toBe(200);
  return { token: extractToken(res.body.text) };
}

describe("initial-owner invitation lifecycle (critical journey)", () => {
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

  it("provisions an Organization, sends a real (recorded) invitation, and activates on acceptance", async () => {
    const ownerEmail = `owner-${uniqueSuffix()}@nova-test.local`;
    const createRes = await authed(app, adminSession)
      .post("/api/platform-admin/organizations")
      .send({ name: `Journey Org ${uniqueSuffix()}`, ownerEmail });
    expect(createRes.status).toBe(201);
    expect(createRes.body.accessStatus).toBe("PROVISIONING");
    const organizationId = createRes.body.id;

    const { token } = await recordedLinkFor(app, ownerEmail);

    const acceptRes = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token, password: OWNER_PASSWORD });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.organizationId).toBe(organizationId);
    expect(acceptRes.body.organizationActivated).toBe(true);
    expect(acceptRes.headers["set-cookie"]?.[0]).toContain("__Host-nova_session=");

    const orgAfter = await authed(app, adminSession).get(`/api/platform-admin/organizations/${organizationId}`);
    expect(orgAfter.body.accessStatus).toBe("ACTIVE");

    // The owner can now log in with the password they just chose.
    const ownerLogin = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: ownerEmail, password: OWNER_PASSWORD });
    expect(ownerLogin.status).toBe(200);

    const prisma = app.get(PrismaService);
    const membership = await prisma.withContext({ organizationId }, (tx) =>
      tx.membership.findFirst({ where: { organizationId } })
    );
    expect(membership?.isOwner).toBe(true);
    expect(membership?.profile).toBe("ADMINISTRATOR");
    expect(membership?.state).toBe("ACTIVE");
  });

  it("SEC-09: the same invitation cannot be accepted twice (replay is refused)", async () => {
    const ownerEmail = `owner-${uniqueSuffix()}@nova-test.local`;
    await authed(app, adminSession)
      .post("/api/platform-admin/organizations")
      .send({ name: `Replay Org ${uniqueSuffix()}`, ownerEmail })
      .expect(201);
    const { token } = await recordedLinkFor(app, ownerEmail);

    const first = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token, password: OWNER_PASSWORD });
    expect(first.status).toBe(200);

    const replay = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token, password: "Another-Different-Password-000" });
    expect(replay.status).toBe(404);
    expect(replay.body.code).toBe("invalid_or_expired_invitation");
  });

  it("SEC-09: concurrent acceptance of the same invitation creates exactly one membership", async () => {
    const ownerEmail = `owner-${uniqueSuffix()}@nova-test.local`;
    const createRes = await authed(app, adminSession)
      .post("/api/platform-admin/organizations")
      .send({ name: `Concurrent Org ${uniqueSuffix()}`, ownerEmail });
    const organizationId = createRes.body.id;
    const { token } = await recordedLinkFor(app, ownerEmail);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post("/api/invitations/accept").send({ token, password: OWNER_PASSWORD }),
      request(app.getHttpServer())
        .post("/api/invitations/accept")
        .send({ token, password: "Second-Concurrent-Password-000" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 404]);

    const prisma = app.get(PrismaService);
    const memberships = await prisma.withContext({ organizationId }, (tx) =>
      tx.membership.findMany({ where: { organizationId } })
    );
    expect(memberships).toHaveLength(1);
  });

  it("SEC-09: an invitation past its expiry boundary is refused", async () => {
    const ownerEmail = `owner-${uniqueSuffix()}@nova-test.local`;
    const createRes = await authed(app, adminSession)
      .post("/api/platform-admin/organizations")
      .send({ name: `Expiry Org ${uniqueSuffix()}`, ownerEmail });
    const organizationId = createRes.body.id;
    const { token } = await recordedLinkFor(app, ownerEmail);

    const prisma = app.get(PrismaService);
    await prisma.withContext({ organizationId, isPlatformAdmin: true }, (tx) =>
      tx.invitation.updateMany({
        where: { organizationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );

    const res = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token, password: OWNER_PASSWORD });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("invalid_or_expired_invitation");
  });

  it("an unknown/forged token is refused with the same neutral code as an expired one", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/invitations/accept")
      .send({ token: "forged-token-that-was-never-issued-00000000000000000000", password: OWNER_PASSWORD });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("invalid_or_expired_invitation");
  });
});
