import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CAPABILITIES, type Capability } from "@nova/shared";
import "./org-context";

export const REQUIRE_CAPABILITY_KEY = "novaRequireCapability";
export const RequireCapability = (capability: Capability) => SetMetadata(REQUIRE_CAPABILITY_KEY, capability);

/**
 * Administrators have full Organization access by profile and never consult
 * this check. A User must hold the exact capability. An unrecognized
 * capability string (should be unreachable given the zod enum, but
 * defense-in-depth) fails closed rather than being silently ignored (SEC-05).
 * Must run after OrgMemberGuard.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Capability | undefined>(REQUIRE_CAPABILITY_KEY, context.getHandler());
    if (!required) return true;
    if (!CAPABILITIES.includes(required)) {
      throw new ForbiddenException({ code: "unknown_capability" });
    }

    const req = context.switchToHttp().getRequest<Request>();
    const member = req.novaOrgMember;
    if (!member) throw new ForbiddenException({ code: "organization_member_required" });
    if (member.membership.profile === "ADMINISTRATOR") return true;
    if (member.capabilities.has(required)) return true;

    throw new ForbiddenException({ code: "capability_required" });
  }
}
