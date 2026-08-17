-- Resolving "which Organization does this identity belong to" (see
-- MyOrganizationController) reads the Organization row via a Membership
-- join before app.org_id is known, under the same trusted system context
-- already used for invitations/memberships self-lookup. SELECT-only.

DROP POLICY IF EXISTS "organizations_select" ON "organizations";

CREATE POLICY "organizations_select" ON "organizations"
  FOR SELECT
  USING (
    "id" = app_current_org_id()
    OR app_is_system()
    OR app_is_platform_admin()
  );
