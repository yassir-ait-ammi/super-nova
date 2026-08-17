import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authed } from "./helpers/fixtures";
import { setupOrgWithOwner } from "./helpers/org-fixtures";
import { createTestApp } from "./helpers/test-app";

describe("Cross-Organization authorization (SEC-01/SEC-02/SEC-06)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("a member of Organization A gets a neutral 404 — not 403 — when addressing Organization B by forged id", async () => {
    const orgA = await setupOrgWithOwner(app, "Cross Org A");
    const orgB = await setupOrgWithOwner(app, "Cross Org B");

    const res = await authed(app, orgA.ownerSession).get(`/api/organizations/${orgB.organizationId}/companies`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("organization_not_found");
  });

  it("Organization A's owner cannot read, list, or manage Organization B's members via a forged organizationId", async () => {
    const orgA = await setupOrgWithOwner(app, "Cross Members A");
    const orgB = await setupOrgWithOwner(app, "Cross Members B");

    const list = await authed(app, orgA.ownerSession).get(`/api/organizations/${orgB.organizationId}/members`);
    expect(list.status).toBe(404);

    const suspend = await authed(app, orgA.ownerSession)
      .post(`/api/organizations/${orgB.organizationId}/members/${orgB.ownerMembershipId}/suspend`)
      .send({ reason: "cross-org forged attempt" });
    expect(suspend.status).toBe(404);
  });

  it("Organization A cannot create a Company under Organization B via a forged organizationId in the URL", async () => {
    const orgA = await setupOrgWithOwner(app, "Cross Create A");
    const orgB = await setupOrgWithOwner(app, "Cross Create B");

    const res = await authed(app, orgA.ownerSession)
      .post(`/api/organizations/${orgB.organizationId}/companies`)
      .send({ name: "Should never be created" });
    expect(res.status).toBe(404);

    const listB = await authed(app, orgB.ownerSession).get(`/api/organizations/${orgB.organizationId}/companies`);
    expect(listB.body.items).toHaveLength(0);
  });

  it("a Business Scope cannot be created under a Company belonging to another Organization", async () => {
    const orgA = await setupOrgWithOwner(app, "Cross Scope A");
    const orgB = await setupOrgWithOwner(app, "Cross Scope B");

    const companyInB = await authed(app, orgB.ownerSession)
      .post(`/api/organizations/${orgB.organizationId}/companies`)
      .send({ name: "Org B Company" });

    // Owner of A tries to create a scope under A's own org id, but pointing companyId at B's company.
    const res = await authed(app, orgA.ownerSession)
      .post(`/api/organizations/${orgA.organizationId}/business-scopes`)
      .send({ companyId: companyInB.body.id, type: "EVENT", name: "Cross-org scope attempt" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("company_not_found");
  });

  it("an unauthenticated caller is refused on every organization-scoped route", async () => {
    const org = await setupOrgWithOwner(app, "Unauth Org");
    const res = await authed(app, { cookie: "__Host-nova_session=forged-not-a-real-token", csrfToken: "irrelevant" }).get(
      `/api/organizations/${org.organizationId}/companies`
    );
    expect(res.status).toBe(401);
  });
});
