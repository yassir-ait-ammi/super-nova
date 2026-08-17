-- Invitations must be look-up-able by their high-entropy token hash alone,
-- before the caller's transaction knows which Organization the invitation
-- belongs to (the token possession IS the authorization proof — SEC-09).
-- Replace the generic tenant_isolation policy with one that additionally
-- allows a trusted system-context read, mirroring email_outbox/organizations.
-- Once the row is found, application code sets app.org_id for the rest of
-- the same transaction, so the write path (status -> ACCEPTED) still goes
-- through the ordinary per-Organization check.

DROP POLICY IF EXISTS tenant_isolation ON "invitations";

CREATE POLICY "invitations_select" ON "invitations"
  FOR SELECT
  USING (
    "organization_id" = app_current_org_id()
    OR app_is_system()
    OR app_is_platform_admin()
  );

CREATE POLICY "invitations_insert" ON "invitations"
  FOR INSERT
  WITH CHECK ("organization_id" = app_current_org_id() OR app_is_platform_admin());

CREATE POLICY "invitations_update" ON "invitations"
  FOR UPDATE
  USING (
    "organization_id" = app_current_org_id()
    OR app_is_system()
    OR app_is_platform_admin()
  )
  WITH CHECK ("organization_id" = app_current_org_id() OR app_is_platform_admin());

CREATE POLICY "invitations_delete" ON "invitations"
  FOR DELETE
  USING ("organization_id" = app_current_org_id() OR app_is_platform_admin());
