import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import "./org-context";
import type { OrgMemberContext } from "./org-context";

export const CurrentOrgMember = createParamDecorator((_data: unknown, ctx: ExecutionContext): OrgMemberContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.novaOrgMember) {
    throw new Error("CurrentOrgMember used outside OrgMemberGuard");
  }
  return req.novaOrgMember;
});
