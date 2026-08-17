-- An authenticated identity needs to resolve which (at most one, per
-- SEC-13) Organization it belongs to before any request has set app.org_id
-- — the same "known secret/identity, unknown org" shape already solved for
-- invitations. Split the generic tenant_isolation policy so SELECT also
-- allows a trusted system-context read; writes remain strictly org-scoped.

DROP POLICY IF EXISTS tenant_isolation ON "memberships";

CREATE POLICY "memberships_select" ON "memberships"
  FOR SELECT
  USING (
    "organization_id" = app_current_org_id()
    OR app_is_system()
    OR app_is_platform_admin()
  );

CREATE POLICY "memberships_insert" ON "memberships"
  FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id());

CREATE POLICY "memberships_update" ON "memberships"
  FOR UPDATE
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());

CREATE POLICY "memberships_delete" ON "memberships"
  FOR DELETE
  USING ("organization_id" = app_current_org_id());
