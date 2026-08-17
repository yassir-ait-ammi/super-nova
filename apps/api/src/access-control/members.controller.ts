import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { membershipActionSchema, updatePermissionsSchema } from "@nova/shared";
import { CurrentOrgMember } from "./current-org-member.decorator";
import type { OrgMemberContext } from "./org-context";
import "./org-context";
import { MembershipService, ScopeGrantInput } from "./membership.service";
import { OrgMemberGuard } from "./org-member.guard";
import { OrgOwnerGuard } from "./org-owner.guard";
import { CapabilityGuard, RequireCapability } from "./require-capability.decorator";
import { RecentAuthGuard } from "../identity/recent-auth.guard";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("organizations/:organizationId/members")
@UseGuards(SessionAuthGuard, OrgMemberGuard, CapabilityGuard)
export class MembersController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  @RequireCapability("MANAGE_COLLABORATORS")
  list(@Param("organizationId") organizationId: string, @CurrentOrgMember() member: OrgMemberContext) {
    return this.memberships.list({ organizationId, membership: member.membership });
  }

  @Patch(":membershipId/permissions")
  @RequireCapability("MANAGE_COLLABORATORS")
  updatePermissions(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(updatePermissionsSchema))
    body: { presetKey?: string; capabilities: string[]; scopeGrants: ScopeGrantInput[] },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.updatePermissions(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      membershipId,
      body
    );
  }

  @Post(":membershipId/suspend")
  @HttpCode(200)
  @RequireCapability("MANAGE_COLLABORATORS")
  suspend(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.suspend(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      membershipId,
      body.reason
    );
  }

  @Post(":membershipId/reactivate")
  @HttpCode(200)
  @RequireCapability("MANAGE_COLLABORATORS")
  reactivate(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.reactivate(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      membershipId,
      body.reason
    );
  }

  @Post(":membershipId/remove")
  @HttpCode(200)
  @RequireCapability("MANAGE_COLLABORATORS")
  remove(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.remove(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      membershipId,
      body.reason
    );
  }

  /** Owner-only, distinct sensitive action (FR-089) — never gated by MANAGE_COLLABORATORS. */
  @Post(":membershipId/promote")
  @HttpCode(200)
  @UseGuards(OrgOwnerGuard, RecentAuthGuard)
  promote(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.promote(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      membershipId,
      body.reason
    );
  }
}
