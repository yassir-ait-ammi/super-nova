import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { membershipActionSchema, ownershipTransferProposeSchema } from "@nova/shared";
import { RecentAuthGuard } from "../identity/recent-auth.guard";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentOrgMember } from "./current-org-member.decorator";
import type { OrgMemberContext } from "./org-context";
import "./org-context";
import { MembershipService } from "./membership.service";
import { OrgMemberGuard } from "./org-member.guard";
import { OrgOwnerGuard } from "./org-owner.guard";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("organizations/:organizationId/ownership-transfer")
@UseGuards(SessionAuthGuard, OrgMemberGuard)
export class OwnershipTransferController {
  constructor(private readonly memberships: MembershipService) {}

  @Get("pending")
  async pending(@Param("organizationId") organizationId: string) {
    // Wrapped in an object (never a bare `null`) so the response is
    // unambiguously JSON regardless of how the HTTP layer serializes a
    // literal `null` body — the client must not have to sniff Content-Type
    // to tell "no pending proposal" apart from "request failed".
    const proposal = await this.memberships.getPendingOwnershipTransfer(organizationId);
    return { proposal };
  }

  @Post("propose")
  @HttpCode(200)
  @UseGuards(OrgOwnerGuard, RecentAuthGuard)
  propose(
    @Param("organizationId") organizationId: string,
    @Body(new ZodValidationPipe(ownershipTransferProposeSchema))
    body: { successorMembershipId: string; reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.proposeOwnershipTransfer(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      body.successorMembershipId,
      body.reason
    );
  }

  @Post(":proposalId/cancel")
  @HttpCode(200)
  @UseGuards(OrgOwnerGuard)
  cancel(
    @Param("organizationId") organizationId: string,
    @Param("proposalId") proposalId: string,
    @Body(new ZodValidationPipe(membershipActionSchema)) body: { reason: string },
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.cancelOwnershipTransfer(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      proposalId,
      body.reason
    );
  }

  /** The proposed successor accepts — verified server-side against the proposal, not implied by any client claim. */
  @Post(":proposalId/accept")
  @HttpCode(200)
  @UseGuards(RecentAuthGuard)
  accept(
    @Param("organizationId") organizationId: string,
    @Param("proposalId") proposalId: string,
    @CurrentOrgMember() member: OrgMemberContext,
    @Req() req: Request
  ) {
    return this.memberships.acceptOwnershipTransfer(
      { organizationId, membership: member.membership, correlationId: correlationId(req) },
      proposalId
    );
  }
}
