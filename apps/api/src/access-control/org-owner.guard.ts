import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import "./org-context";

/** Owner-only sensitive actions (promotion, ownership transfer). Must run after OrgMemberGuard. */
@Injectable()
export class OrgOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.novaOrgMember?.membership.isOwner) {
      throw new ForbiddenException({ code: "organization_owner_required" });
    }
    return true;
  }
}
