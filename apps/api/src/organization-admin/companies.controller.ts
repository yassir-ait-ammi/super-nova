import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  createCompanySchema,
  directoryQuerySchema,
  membershipActionSchema,
  updateCompanySchema,
} from "@nova/shared";
import { CapabilityGuard, RequireCapability } from "../access-control/require-capability.decorator";
import { CurrentOrgMember } from "../access-control/current-org-member.decorator";
import "../access-control/org-context";
import { OrgMemberGuard } from "../access-control/org-member.guard";
import type { OrgMemberContext } from "../access-control/org-context";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { CompaniesService } from "./companies.service";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("organizations/:organizationId/companies")
@UseGuards(SessionAuthGuard, OrgMemberGuard, CapabilityGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequireCapability("VIEW_COMPANIES")
  list(
    @Param("organizationId") organizationId: string,
    @CurrentOrgMember() member: OrgMemberContext,
    @Query(new ZodValidationPipe(directoryQuerySchema)) query: { search?: string; page: number; pageSize: number }
  ) {
    return this.companies.list({ organizationId, membership: member.membership }, query);
  }

  @Get(":companyId")
  @RequireCapability("VIEW_COMPANIES")
  get(
    @Param("organizationId") organizationId: string,
    @Param("companyId") companyId: string,
    @CurrentOrgMember() member: OrgMemberContext
  ) {
    return this.companies.get({ organizationId, membership: member.membership }, companyId);
  }

  @Post()
  @RequireCapability("MANAGE_COMPANIES")
  create(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(createCompanySchema)) body: { name: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.companies.create(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      body.name
    );
  }

  @Patch(":companyId")
  @RequireCapability("MANAGE_COMPANIES")
  update(
    @Param("organizationId") organizationId: string,
    @Param("companyId") companyId: string,
    @Body(new ZodValidationPipe(updateCompanySchema)) body: { name: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.companies.update(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      companyId,
      body.name
    );
  }

  @Post(":companyId/deactivate")
  @HttpCode(200)
  @RequireCapability("MANAGE_COMPANIES")
  deactivate(
    @Param("organizationId") organizationId: string,
    @Param("companyId") companyId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.companies.deactivate(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      companyId,
      body.reason
    );
  }
}
