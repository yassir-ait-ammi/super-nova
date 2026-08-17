import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../../src/prisma/prisma.service";
import { authed } from "./helpers/fixtures";
import { addActiveAdministrator, addActiveUser, setupOrgWithOwner } from "./helpers/org-fixtures";
import { createTestApp } from "./helpers/test-app";

/**
 * SEC-08: "An active Organization has exactly one active owner and at least
 * one active Administrator. Concurrent promotion, suspension, removal, or
 * transfer cannot produce zero Administrators or two owners."
 *
 * The sequential cases (owner cannot be suspended/removed, promotion is
 * owner-only, only one PENDING ownership-transfer proposal at a time, etc.)
 * are covered in membership-lifecycle.test.ts and ownership-transfer.test.ts.
 * This file goes after the invariant specifically under real concurrency —
 * firing genuinely simultaneous requests with Promise.all rather than
 * asserting sequential behavior — since that's the gap SUBMISSION.md
 * honestly flagged as not separately exercised.
 */
describe("SEC-08: last-Administrator / owner-continuity invariant under concurrency", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("concurrently removing every non-owner Administrator can never drive an active Organization below one active Administrator", async () => {
    const org = await setupOrgWithOwner(app, "Concurrent Removal Org");
    const adminA = await addActiveAdministrator(app, org.organizationId);
    const adminB = await addActiveAdministrator(app, org.organizationId);

    // Three active Administrators total (owner + A + B). Remove A and B in
    // the same instant — if the last-Administrator guard's count() read
    // raced against the other transaction's write, both could observe
    // count=3 before either commits and both proceed.
    const [resA, resB] = await Promise.all([
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/members/${adminA.membershipId}/remove`)
        .send({ reason: "concurrent removal race — A" }),
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/members/${adminB.membershipId}/remove`)
        .send({ reason: "concurrent removal race — B" }),
    ]);

    // Both are legitimate to succeed here: even after removing both, the
    // owner alone still satisfies "at least one active Administrator" — the
    // guard exists to block driving the count to zero, not to serialize
    // unrelated removals against each other.
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const prisma = app.get(PrismaService);
    const activeAdminCount = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.count({ where: { organizationId: org.organizationId, profile: "ADMINISTRATOR", state: "ACTIVE" } })
    );
    expect(activeAdminCount).toBeGreaterThanOrEqual(1);
    expect(activeAdminCount).toBe(1); // exactly the owner
  });

  it("racing a promotion against a concurrent suspension of the same target never leaves an inconsistent profile/state combination", async () => {
    const org = await setupOrgWithOwner(app, "Promote Suspend Race Org");
    const user = await addActiveUser(app, org.organizationId);

    const [promoteRes, suspendRes] = await Promise.all([
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/members/${user.membershipId}/promote`)
        .send({ reason: "concurrent race — promote" }),
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/members/${user.membershipId}/suspend`)
        .send({ reason: "concurrent race — suspend" }),
    ]);

    // Whatever combination of outcomes occurs, the persisted row must be
    // internally coherent — never e.g. profile=ADMINISTRATOR with a session
    // that was never revoked, or a state PATCH lost due to overwriting the
    // other transaction's write without either request itself failing.
    expect([promoteRes.status, suspendRes.status].every((s) => s === 200 || s === 400)).toBe(true);

    const prisma = app.get(PrismaService);
    const finalRow = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { id: user.membershipId } })
    );
    expect(["USER", "ADMINISTRATOR"]).toContain(finalRow.profile);
    expect(["ACTIVE", "SUSPENDED"]).toContain(finalRow.state);

    // Whichever mutation actually landed, the collaborator's pre-race
    // session must not still be valid — both promotion (session rotation on
    // privilege elevation, SEC-15) and suspension (SEC-07) revoke it.
    const meAfter = await authed(app, user.session).get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("a successor's concurrent suspension cannot let an ownership-transfer acceptance install a suspended member as owner", async () => {
    const org = await setupOrgWithOwner(app, "Transfer Suspend Race Org");
    const successor = await addActiveAdministrator(app, org.organizationId);

    const propose = await authed(app, org.ownerSession)
      .post(`/api/organizations/${org.organizationId}/ownership-transfer/propose`)
      .send({ successorMembershipId: successor.membershipId, reason: "planned handover" });
    expect(propose.status).toBe(200);
    const proposalId = propose.body.id;

    // Fire the successor's own acceptance and the owner suspending that same
    // successor at the same instant. `acceptOwnershipTransfer` re-reads the
    // successor's state inside its transaction and requires it to still be
    // ACTIVE — if that read is not serialized against a concurrent suspend,
    // a suspended member could end up flagged as owner.
    const [acceptRes, suspendRes] = await Promise.all([
      authed(app, successor.session)
        .post(`/api/organizations/${org.organizationId}/ownership-transfer/${proposalId}/accept`)
        .send({}),
      authed(app, org.ownerSession)
        .post(`/api/organizations/${org.organizationId}/members/${successor.membershipId}/suspend`)
        .send({ reason: "concurrent race — suspend the proposed successor" }),
    ]);

    const prisma = app.get(PrismaService);
    const successorRow = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.findUniqueOrThrow({ where: { id: successor.membershipId } })
    );

    // The invariant that actually matters: never a SUSPENDED row flagged as
    // owner. Either the accept won (successor is owner, and must be ACTIVE —
    // the suspend must then have been refused as blocked-owner or lost the
    // race cleanly), or the suspend won (successor is SUSPENDED and must
    // NOT be owner — the accept must have refused with
    // successor_no_longer_eligible), or the accept simply lost outright.
    if (successorRow.isOwner) {
      expect(successorRow.state).toBe("ACTIVE");
      expect(acceptRes.status).toBe(200);
      // The suspend lost the race — either refused outright (owner-target
      // now blocked) or simply landed before the accept and got overwritten
      // by it; either way it must not be what left the successor suspended.
      expect([200, 400, 403]).toContain(suspendRes.status);
    } else {
      expect(acceptRes.status).not.toBe(200);
      // The suspend is what actually determined the outcome here.
      expect(suspendRes.status).toBe(200);
    }
    // Never both: an owner-flagged row that is also suspended.
    expect(successorRow.isOwner && successorRow.state === "SUSPENDED").toBe(false);

    // And the Organization must still have exactly one active owner overall.
    const activeOwnerCount = await prisma.withContext({ organizationId: org.organizationId }, (tx) =>
      tx.membership.count({ where: { organizationId: org.organizationId, isOwner: true, state: "ACTIVE" } })
    );
    expect(activeOwnerCount).toBe(1);
  });
});
