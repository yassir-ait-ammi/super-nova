import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganization, uniqueSuffix } from "./helpers/fixtures";
import { createTestApp } from "./helpers/test-app";

/**
 * NFR-001 / SEC-01 / SEC-05: forced row-level security is the backstop
 * behind application authorization. These tests talk to Postgres as the
 * nova_app runtime role directly (bypassing the NestJS app entirely) to
 * prove the database itself refuses cross-Organization access — not just
 * that the application happens to filter correctly.
 */
describe("forced row-level security", () => {
  let app: INestApplication;
  let orgA: { id: string };
  let orgB: { id: string };
  let appRole: Client;

  beforeAll(async () => {
    app = await createTestApp();
    orgA = await createOrganization(app, { name: `RLS Org A ${uniqueSuffix()}` });
    orgB = await createOrganization(app, { name: `RLS Org B ${uniqueSuffix()}` });
    appRole = new Client({ connectionString: process.env.APP_DATABASE_URL });
    await appRole.connect();
  });

  afterAll(async () => {
    await appRole.end();
    await app.close();
  });

  it("SEC-05: refuses all access with no tenant context set (fails closed)", async () => {
    await appRole.query("BEGIN");
    const rows = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");
    expect(rows.rows.find((r) => r.id === orgA.id)).toBeUndefined();
    expect(rows.rows.find((r) => r.id === orgB.id)).toBeUndefined();
  });

  it("isolates reads: Organization A's context never returns Organization B's row", async () => {
    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgA.id}'`);
    const rows = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");
    expect(rows.rows.map((r) => r.id)).toEqual([orgA.id]);
  });

  it("SEC-05: a malformed tenant context errors instead of silently granting access", async () => {
    await appRole.query("BEGIN");
    await expect(
      (async () => {
        await appRole.query("SET LOCAL app.org_id = 'not-a-real-uuid'");
        await appRole.query<{ id: string }>("SELECT id FROM organizations");
      })()
    ).rejects.toThrow();
    await appRole.query("ROLLBACK").catch(() => undefined);
  });

  it("a reused pooled connection alternating A -> B -> A never leaks across transactions", async () => {
    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgA.id}'`);
    const asA1 = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");

    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgB.id}'`);
    const asB = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");

    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgA.id}'`);
    const asA2 = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");

    expect(asA1.rows.map((r) => r.id)).toEqual([orgA.id]);
    expect(asB.rows.map((r) => r.id)).toEqual([orgB.id]);
    expect(asA2.rows.map((r) => r.id)).toEqual([orgA.id]);

    // And a fresh transaction on the SAME connection with no SET LOCAL at
    // all must not inherit context from the prior transaction.
    await appRole.query("BEGIN");
    const noCtx = await appRole.query<{ id: string }>("SELECT id FROM organizations");
    await appRole.query("COMMIT");
    expect(noCtx.rows).toHaveLength(0);
  });

  it("SEC-04: cannot insert a Company under an Organization it does not belong to via a forged organization_id", async () => {
    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgA.id}'`);
    // Even though the transaction is scoped to Org A, attempting to write a
    // row claiming Org B's id is rejected by the WITH CHECK clause.
    await expect(
      appRole.query(
        `INSERT INTO companies (id, organization_id, name, normalized_name, status, updated_at) VALUES (gen_random_uuid(), $1, 'x', 'x', 'ACTIVE', now())`,
        [orgB.id]
      )
    ).rejects.toThrow();
    await appRole.query("ROLLBACK").catch(() => undefined);
  });

  it("SEC-06: Organization A cannot count or search into Organization B's data", async () => {
    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.org_id = '${orgA.id}'`);
    const count = await appRole.query("SELECT count(*)::int AS n FROM organizations WHERE id = $1", [orgB.id]);
    await appRole.query("COMMIT");
    expect(count.rows[0].n).toBe(0);
  });

  it("every table with an organization_id column enables and forces row-level security (schema-driven — fails on a new unprotected tenant table)", async () => {
    const migrator = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
    await migrator.connect();
    // Discovered from the schema itself, not a hand-maintained list: any
    // table carrying organization_id is tenant-owned by definition (SEC-01)
    // and MUST be RLS-protected — this is what makes SEC-05's requirement
    // ("the test suite must fail if a new tenant-owned table lacks ...
    // classification, RLS policy") actually true as the schema grows.
    const result = await migrator.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT DISTINCT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM information_schema.columns col
       JOIN pg_class c ON c.relname = col.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
       WHERE col.table_schema = 'public' AND col.column_name = 'organization_id' AND c.relkind = 'r'`
    );

    // "organizations" itself defines the tenant (its PK *is* the tenant id,
    // not an organization_id column) but must still be RLS-protected —
    // assert it explicitly alongside the schema-discovered set.
    const orgRow = await migrator.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'organizations'`
    );
    await migrator.end();

    const discovered = result.rows.map((r) => r.relname);
    expect(discovered.length).toBeGreaterThanOrEqual(8); // guards against the query itself silently matching nothing
    expect(discovered).toContain("companies");
    expect(discovered).toContain("ownership_transfer_proposals");

    for (const row of result.rows) {
      expect(row.relrowsecurity, `${row.relname} must enable RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} must FORCE RLS (owner cannot bypass)`).toBe(true);
    }
    expect(orgRow.rows[0]?.relrowsecurity).toBe(true);
    expect(orgRow.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it("SEC-03: the nova_app runtime role owns nothing and cannot bypass RLS", async () => {
    const migrator = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
    await migrator.connect();
    const role = await migrator.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'nova_app'"
    );
    const ownedTables = await migrator.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'nova_app'`
    );
    await migrator.end();

    expect(role.rows[0]?.rolbypassrls).toBe(false);
    expect(role.rows[0]?.rolsuper).toBe(false);
    expect(ownedTables.rows[0]?.count).toBe("0");
  });
});
