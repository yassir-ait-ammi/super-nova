-- Tenant-safe composite FKs for the two plain UUID columns that reference
-- Membership but aren't modeled as Prisma relations (Prisma would require
-- two differently-named relations to the same model; simpler to add these
-- exactly like membership_scope_grants' company/business-scope FKs).
ALTER TABLE "ownership_transfer_proposals"
  ADD CONSTRAINT "ownership_transfer_proposals_proposer_org_fkey"
  FOREIGN KEY ("proposer_membership_id", "organization_id")
  REFERENCES "memberships" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ownership_transfer_proposals"
  ADD CONSTRAINT "ownership_transfer_proposals_successor_org_fkey"
  FOREIGN KEY ("successor_membership_id", "organization_id")
  REFERENCES "memberships" ("id", "organization_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one PENDING transfer proposal per Organization at a time.
CREATE UNIQUE INDEX "ownership_transfer_proposals_one_pending_per_org"
  ON "ownership_transfer_proposals" ("organization_id")
  WHERE "status" = 'PENDING';

ALTER TABLE "ownership_transfer_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ownership_transfer_proposals" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ownership_transfer_proposals"
  FOR ALL
  USING ("organization_id" = app_current_org_id())
  WITH CHECK ("organization_id" = app_current_org_id());
