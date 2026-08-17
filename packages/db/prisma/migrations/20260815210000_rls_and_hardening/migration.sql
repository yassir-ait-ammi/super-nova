-- Hand-reviewed security migration. Not generated from schema.prisma diffing
-- (RLS/roles/grants are not representable in the Prisma schema language).
--
-- Implements:
--  * SEC-01/SEC-03: forced row-level security on every tenant-owned table,
--    enforced through a transaction-local Postgres tenant context.
--  * SEC-04: tenant-safe composite FK for the last unmodelled cross-table
--    reference (membership_scope_grants -> companies / business_scopes).
--  * SEC-05: missing/invalid/malformed tenant context fails closed (see the
--    app_current_org_id()/app_is_platform_admin()/app_is_system() helpers).
--  * SEC-08: an active Organization can never end up with two active owners
--    (partial unique index) — "at least one Administrator" is enforced at
--    the application layer inside serialized transactions, since it is an
--    existence constraint that a unique index cannot express.
--  * SEC-09/FR-089: at most one PENDING invitation per Organization+email.
--  * Runtime least privilege: the nova_app role owns nothing and is granted
--    only the row-filtered access it needs; PUBLIC gets nothing.

-- ---------------------------------------------------------------------------
-- Tenant-context helper functions
-- ---------------------------------------------------------------------------

-- Returns the org id the current transaction is scoped to, or NULL if unset.
-- An explicitly-set but malformed value raises an error (fails closed rather
-- than silently granting access) instead of being swallowed.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- True only when the current transaction was explicitly opened as an
-- authenticated Platform Administrator action (set server-side, never from
-- client input).
CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.is_platform_admin', true), 'false') = 'true'
$$;

-- True only for trusted, unauthenticated system flows that legitimately have
-- no Organization or actor context yet (login attempt, password-reset
-- request/completion, new-identity invitation acceptance prior to session
-- issuance). Set only by server-side infrastructure, never by request input.
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.is_system', true), 'false') = 'true'
$$;

-- ---------------------------------------------------------------------------
-- Additional tenant-safe relations not representable via Prisma relations
-- ---------------------------------------------------------------------------

ALTER TABLE "membership_scope_grants"
  ADD CONSTRAINT "membership_scope_grants_target_check"
  CHECK ("company_id" IS NOT NULL OR "business_scope_id" IS NOT NULL);

ALTER TABLE "membership_scope_grants"
  ADD CONSTRAINT "membership_scope_grants_company_org_fkey"
  FOREIGN KEY ("company_id", "organization_id")
  REFERENCES "companies" ("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "membership_scope_grants"
  ADD CONSTRAINT "membership_scope_grants_business_scope_org_fkey"
  FOREIGN KEY ("business_scope_id", "organization_id")
  REFERENCES "business_scopes" ("id", "organization_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Lifecycle invariants expressible as constraints
-- ---------------------------------------------------------------------------

-- SEC-08: at most one ACTIVE owner per Organization at any time. (The
-- complementary "at least one active Administrator" existence rule is
-- enforced in serialized application transactions — see identity module.)
CREATE UNIQUE INDEX "memberships_one_active_owner_per_org"
  ON "memberships" ("organization_id")
  WHERE "is_owner" = true AND "state" = 'ACTIVE';

-- SEC-09/FR-089: at most one active (PENDING) invitation per Organization
-- and normalized email; resend must transition the old row instead of
-- inserting a second one.
CREATE UNIQUE INDEX "invitations_one_pending_per_org_email"
  ON "invitations" ("organization_id", "normalized_email")
  WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- Row-level security — tenant-owned tables
-- ---------------------------------------------------------------------------

-- organizations: the tenant root. A member (via app.org_id) sees only their
-- own row; a Platform Administrator sees the minimized directory across all
-- Organizations. Only a Platform Administrator may create or update a row,
-- and updates are additionally scoped to the one Organization the current
-- transaction was opened against (SEC-10 — no broad cross-Organization
-- write even for platform admins).
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "organizations_select" ON "organizations"
  FOR SELECT
  USING ("id" = app_current_org_id() OR app_is_platform_admin());

CREATE POLICY "organizations_insert" ON "organizations"
  FOR INSERT
  WITH CHECK (app_is_platform_admin());

CREATE POLICY "organizations_update" ON "organizations"
  FOR UPDATE
  USING (app_is_platform_admin() AND "id" = app_current_org_id())
  WITH CHECK (app_is_platform_admin() AND "id" = app_current_org_id());

-- Standard tenant-isolation policy shared by ordinary tenant-owned tables:
-- every row must belong to the Organization the current transaction is
-- scoped to, for every command. Platform Administrator narrow interventions
-- go through the same policy by setting app.org_id to the single targeted
-- Organization for that transaction (never a blanket bypass).
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'companies', 'business_scopes', 'memberships',
    'membership_capabilities', 'membership_scope_grants', 'invitations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_current_org_id()) WITH CHECK (organization_id = app_current_org_id())',
      tbl
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Row-level security — platform-operational tables
-- ---------------------------------------------------------------------------
-- email_outbox and admin_evidence are never read on behalf of an individual
-- tenant request (no endpoint returns their contents to a customer user);
-- they are internal delivery/evidence plumbing written by trusted
-- server-side code paths. RLS is still enabled and forced so that only
-- transactions explicitly opened as platform-admin, system, or a matching
-- Organization context can touch them — a defense-in-depth backstop against
-- a future, less-trusted caller reusing the same connection pool.

ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_outbox" FORCE ROW LEVEL SECURITY;

CREATE POLICY "email_outbox_access" ON "email_outbox"
  FOR ALL
  USING (
    app_is_system()
    OR app_is_platform_admin()
    OR ("organization_id" IS NOT NULL AND "organization_id" = app_current_org_id())
  )
  WITH CHECK (
    app_is_system()
    OR app_is_platform_admin()
    OR ("organization_id" IS NOT NULL AND "organization_id" = app_current_org_id())
  );

ALTER TABLE "admin_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_evidence" FORCE ROW LEVEL SECURITY;

CREATE POLICY "admin_evidence_select" ON "admin_evidence"
  FOR SELECT
  USING (
    app_is_platform_admin()
    OR ("organization_id" IS NOT NULL AND "organization_id" = app_current_org_id())
  );

CREATE POLICY "admin_evidence_insert" ON "admin_evidence"
  FOR INSERT
  WITH CHECK (
    app_is_platform_admin()
    OR app_is_system()
    OR ("organization_id" IS NOT NULL AND "organization_id" = app_current_org_id())
  );

-- Evidence is an append-only ledger: no UPDATE/DELETE policy is defined for
-- any role, so both commands are denied outright by forced RLS.

-- ---------------------------------------------------------------------------
-- Least-privilege grants for the runtime role
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO nova_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nova_app;

-- Organizations are provisioned or terminally disabled, never deleted.
REVOKE DELETE ON "organizations" FROM nova_app;

-- Evidence is append-only at the database-privilege level too.
REVOKE UPDATE, DELETE ON "admin_evidence" FROM nova_app;

-- nova_app must never be able to grant its own privileges onward or create
-- objects; it already lacks CREATEDB/CREATEROLE/SUPERUSER/BYPASSRLS from
-- role creation (see scripts/bootstrap-roles.ts).
