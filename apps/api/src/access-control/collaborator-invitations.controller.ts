import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { inviteCollaboratorSchema, membershipActionSchema } from "@nova/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { CurrentOrgMember } from "./current-org-member.decorator";
import type { OrgMemberContext } from "./org-context";
import "./org-context";
import { InvitationsService } from "./invitations.service";
import type { ScopeGrantInput } from "./membership.service";
import { OrgMemberGuard } from "./org-member.guard";
import { CapabilityGuard, RequireCapability } from "./require-capability.decorator";
import { PrismaService } from "../prisma/prisma.service";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("organizations/:organizationId/invitations")
@UseGuards(SessionAuthGuard, OrgMemberGuard, CapabilityGuard)
export class CollaboratorInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  @RequireCapability("MANAGE_COLLABORATORS")
  list(@Param("organizationId") organizationId: string) {
    return this.invitations.listInvitations(organizationId);
  }

  @Post()
  @RequireCapability("MANAGE_COLLABORATORS")
  async invite(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(inviteCollaboratorSchema))
    body: { email: string; presetKey?: string; capabilities: string[]; scopeGrants: ScopeGrantInput[] },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    const organization = await this.prisma.withContext({ organizationId }, (tx) =>
      tx.organization.findUniqueOrThrow({ where: { id: organizationId } })
    );

    return this.invitations.createCollaboratorInvitation({
      organizationId,
      organizationName: organization.name,
      inviterMembershipId: member.membership.id,
      inviterIdentityId: member.membership.identityId,
      inviterLabel: "An Organization Administrator",
      email: body.email,
      presetKey: body.presetKey,
      capabilities: body.capabilities,
      scopeGrants: body.scopeGrants,
      correlationId: correlationId(req),
    });
  }

  @Post(":invitationId/resend")
  @HttpCode(200)
  @RequireCapability("MANAGE_COLLABORATORS")
  resend(
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.invitations.resendInvitation(organizationId, member.membership.identityId, invitationId, correlationId(req));
  }

  @Post(":invitationId/revoke")
  @HttpCode(200)
  @RequireCapability("MANAGE_COLLABORATORS")
  revoke(
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext
  ) {
    return this.invitations.revokeInvitation(organizationId, member.membership.identityId, invitationId, body.reason);
  }
}
