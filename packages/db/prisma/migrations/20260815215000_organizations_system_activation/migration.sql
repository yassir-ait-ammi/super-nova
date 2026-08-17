-- Initial-owner invitation acceptance activates the Organization
-- (PROVISIONING -> ACTIVE) as part of a trusted, narrowly-scoped SYSTEM
-- transaction (no platform-admin actor — the caller is the newly-created
-- owner identity itself, authorized purely by possession of the invitation
-- token). The original organizations_update policy only allowed
-- app_is_platform_admin(), which wrongly also blocked this legitimate path.
-- Replace it to allow either platform-admin or system context, still scoped
-- to exactly the one Organization the transaction was opened against.

DROP POLICY IF EXISTS "organizations_update" ON "organizations";

CREATE POLICY "organizations_update" ON "organizations"
  FOR UPDATE
  USING ((app_is_platform_admin() OR app_is_system()) AND "id" = app_current_org_id())
  WITH CHECK ((app_is_platform_admin() OR app_is_system()) AND "id" = app_current_org_id());
