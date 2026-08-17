import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed, uniqueSuffix } from "./helpers/fixtures";
import { addActiveUser, setupOrgWithOwner } from "./helpers/org-fixtures";
import { createTestApp } from "./helpers/test-app";

describe("Companies and Business Scopes (Organization administration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("FR-009: an Administrator creates a Company, then a duplicate-aware Business Scope under it", async () => {
    const org = await setupOrgWithOwner(app, "Companies Org");
    const companyName = `Acme ${uniqueSuffix()}`;

    const createCompany = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: companyName });
    expect(createCompany.status).toBe(201);
    const companyId = createCompany.body.id;

    const dup = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: companyName });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("company_name_taken");

    const dupCheck = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/business-scopes/check-duplicate`)
      .send({ companyId, type: "RESTAURANT", name: "Downtown" });
    expect(dupCheck.status).toBe(201);
    expect(dupCheck.body.duplicate).toBe(false);

    const createScope = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/business-scopes`)
      .send({ companyId, type: "RESTAURANT", name: "Downtown" });
    expect(createScope.status).toBe(201);

    const dupScope = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/business-scopes`)
      .send({ companyId, type: "RESTAURANT", name: "Downtown" });
    expect(dupScope.status).toBe(409);
    expect(dupScope.body.code).toBe("business_scope_duplicate");
  });

  it("SEC-09-style concurrency: two concurrent identical scope creations produce exactly one scope", async () => {
    const org = await setupOrgWithOwner(app, "Concurrent Scope Org");
    const createCompany = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: `Concurrent Co ${uniqueSuffix()}` });
    const companyId = createCompany.body.id;

    const [a, b] = await Promise.all([
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/business-scopes`)
        .send({ companyId, type: "CONSTRUCTION", name: "Site One" }),
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/business-scopes`)
        .send({ companyId, type: "CONSTRUCTION", name: "Site One" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const list = await authed(app, org.ownerSession).get(
      `/api/organizations/${org.organizationId}/business-scopes?companyId=${companyId}`
    );
    expect(list.body.items).toHaveLength(1);
  });

  it("a Company with an active Business Scope cannot be deactivated by cascade", async () => {
    const org = await setupOrgWithOwner(app, "Blocked Deactivation Org");
    const createCompany = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: `Blocking Co ${uniqueSuffix()}` });
    const companyId = createCompany.body.id;
    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/business-scopes`)
      .send({ companyId, type: "EVENT", name: "Launch Party" })
      .expect(201);

    const deactivate = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies/${companyId}/deactivate`)
      .send({ reason: "no longer trading" });
    expect(deactivate.status).toBe(400);
    expect(deactivate.body.code).toBe("company_has_active_business_scopes");
    expect(deactivate.body.details.blockingBusinessScopes).toHaveLength(1);
  });

  it("FR-114/FR-116: a User without VIEW_COMPANIES capability is refused; with it, sees only granted Companies", async () => {
    const org = await setupOrgWithOwner(app, "Scoped Visibility Org");
    const companyA = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: `Visible Co ${uniqueSuffix()}` });
    const companyB = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/companies`)
      .send({ name: `Hidden Co ${uniqueSuffix()}` });

    const noCapability = await addActiveUser(app, org.organizationId, []);
    const forbidden = await authed(app, noCapability.session).get(`/api/organizations/${org.organizationId}/companies`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("capability_required");

    const scopedUser = await addActiveUser(app, org.organizationId, ["VIEW_COMPANIES"]);
    // Grant scoped user access to only companyA.
    const prisma = app.get(PrismaService);
    await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membershipScopeGrant.create({
        data: { organizationId: org.organizationId, membershipId: scopedUser.membershipId, companyId: companyA.body.id },
      })
    );

    const list = await authed(app, scopedUser.session).get(`/api/organizations/${org.organizationId}/companies`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([companyA.body.id]);
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(companyB.body.id);
  });
});
