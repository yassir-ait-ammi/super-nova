import type { Membership, MembershipCapability } from "@nova/db";

export interface OrgMemberContext {
  membership: Membership;
  capabilities: Set<string>;
}

declare module "express" {
  interface Request {
    novaOrgMember?: OrgMemberContext;
  }
}

export function capabilitiesFromRows(rows: Pick<MembershipCapability, "capability">[]): Set<string> {
  return new Set(rows.map((r) => r.capability));
}
