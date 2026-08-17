import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  checkBusinessScopeDuplicateSchema,
  createBusinessScopeSchema,
  membershipActionSchema,
} from "@nova/shared";
import { CurrentOrgMember } from "../access-control/current-org-member.decorator";
import type { OrgMemberContext } from "../access-control/org-context";
import "../access-control/org-context";
import { OrgMemberGuard } from "../access-control/org-member.guard";
import { CapabilityGuard, RequireCapability } from "../access-control/require-capability.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { BusinessScopesService, CreateBusinessScopeInput } from "./business-scopes.service";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("organizations/:organizationId/business-scopes")
@UseGuards(SessionAuthGuard, OrgMemberGuard, CapabilityGuard)
export class BusinessScopesController {
  constructor(private readonly businessScopes: BusinessScopesService) {}

  @Get()
  @RequireCapability("VIEW_BUSINESS_SCOPES")
  list(
    @Param("organizationId") organizationId: string,
    @CurrentOrgMember() member: OrgMemberContext,
    @Query() query: { companyId?: string; search?: string; page?: string; pageSize?: string }
  ) {
    return this.businessScopes.list(
      { organizationId, membership: member.membership },
      {
        companyId: query.companyId,
        search: query.search,
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : 20,
      }
    );
  }

  @Post("check-duplicate")
  @RequireCapability("MANAGE_BUSINESS_SCOPES")
  checkDuplicate(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(checkBusinessScopeDuplicateSchema))
    body: CreateBusinessScopeInput,
    @CurrentOrgMember() member: OrgMemberContext
  ) {
    return this.businessScopes.checkDuplicate({ organizationId, membership: member.membership }, body);
  }

  @Post()
  @RequireCapability("MANAGE_BUSINESS_SCOPES")
  create(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(createBusinessScopeSchema)) body: CreateBusinessScopeInput,
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.businessScopes.create(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      body
    );
  }

  @Post(":businessScopeId/deactivate")
  @HttpCode(200)
  @RequireCapability("MANAGE_BUSINESS_SCOPES")
  deactivate(
    @Param("organizationId") organizationId: string,
    @Param("businessScopeId") businessScopeId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.businessScopes.deactivate(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      businessScopeId,
      body.reason
    );
  }
}
