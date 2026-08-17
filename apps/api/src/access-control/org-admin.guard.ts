import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import "./org-context";

/** Must run after OrgMemberGuard. */
@Injectable()
export class OrgAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.novaOrgMember?.membership.profile !== "ADMINISTRATOR") {
      throw new ForbiddenException({ code: "organization_administrator_required" });
    }
    return true;
  }
}
