import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed } from "./helpers/fixtures";
import { addActiveAdministrator, addActiveUser, setupOrgWithOwner } from "./helpers/org-fixtures";
import { createTestApp } from "./helpers/test-app";

describe("Atomic ownership transfer", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("FR-089: propose -> accept leaves exactly one owner; the former owner remains an Administrator", async () => {
    const org = await setupOrgWithOwner(app, "Transfer Org");
    const successor = await addActiveAdministrator(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successor.membershipId, reason: "stepping back from day-to-day ownership" });
    expect(propose.status).toBe(200);
    const proposalId = propose.body.id;

    // Nothing changes until acceptance.
    const prisma = app.get(PrismaService);
    const beforeAccept = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findUnique({ where: { id: org.ownerMembershipId } })
    );
    expect(beforeAccept?.isOwner).toBe(true);

    const accept = await authed(app, successor.session)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${proposalId}/accept`)
      .send({});
    expect(accept.status).toBe(200);

    const [formerOwner, newOwner] = await Promise.all([
      prisma.withContext({ organizationId: org.organizationId }, (tx) => tx.membership.findUnique({ where: { id: org.ownerMembershipId } })),
      prisma.withContext({ organizationId: org.organizationId }, (tx) => tx.membership.findUnique({ where: { id: successor.membershipId } })),
    ]);
    expect(formerOwner?.isOwner).toBe(false);
    expect(formerOwner?.profile).toBe("ADMINISTRATOR"); // remains an Administrator
    expect(newOwner?.isOwner).toBe(true);

    const owners = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.count({ where: { organizationId: org.organizationId, isOwner: true, state: "ACTIVE" } })
    );
    expect(owners).toBe(1);
  });

  it("only one PENDING proposal may exist per Organization at a time", async () => {
    const org = await setupOrgWithOwner(app, "Concurrent Transfer Org");
    const successorA = await addActiveAdministrator(app, org.organizationId);
    const successorB = await addActiveAdministrator(app, org.organizationId);

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successorA.membershipId, reason: "first proposal" })
      .expect(200);

    const second = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successorB.membershipId, reason: "second proposal" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ownership_transfer_already_pending");
  });

  it("a successor must be an active Administrator — a User cannot be proposed", async () => {
    const org = await setupOrgWithOwner(app, "Ineligible Successor Org");
    const user = await addActiveUser(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: user.membershipId, reason: "attempted transfer to a User" });
    expect(propose.status).toBe(400);
    expect(propose.body.code).toBe("successor_not_eligible");
  });

  it("only the proposer (owner) can cancel; cancellation allows a new proposal", async () => {
    const org = await setupOrgWithOwner(app, "Cancel Transfer Org");
    const successorA = await addActiveAdministrator(app, org.organizationId);
    const successorB = await addActiveAdministrator(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successorA.membershipId, reason: "initial proposal" });

    const cancelByNonOwner = await authed(app, successorA.session)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${propose.body.id}/cancel`)
      .send({ reason: "not allowed" });
    expect(cancelByNonOwner.status).toBe(403);

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${propose.body.id}/cancel`)
      .send({ reason: "changed my mind" })
      .expect(200);

    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successorB.membershipId, reason: "new proposal after cancellation" })
      .expect(200);
  });

  it("a cancelled proposal cannot later be accepted", async () => {
    const org = await setupOrgWithOwner(app, "Accept-After-Cancel Org");
    const successor = await addActiveAdministrator(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successor.membershipId, reason: "will be cancelled" });
    await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${propose.body.id}/cancel`)
      .send({ reason: "cancelling" })
      .expect(200);

    const accept = await authed(app, successor.session)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${propose.body.id}/accept`)
      .send({});
    expect(accept.status).toBe(404);
  });

  it("only the proposed successor can accept — another Administrator cannot", async () => {
    const org = await setupOrgWithOwner(app, "Wrong Successor Org");
    const successor = await addActiveAdministrator(app, org.organizationId);
    const otherAdmin = await addActiveAdministrator(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successor.membershipId, reason: "proposal" });

    const wrongAccept = await authed(app, otherAdmin.session)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/${propose.body.id}/accept`)
      .send({});
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.code).toBe("not_the_proposed_successor");
  });
});
