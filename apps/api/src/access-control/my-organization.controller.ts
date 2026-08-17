import { Controller, Get, NotFoundException, UseGuards } from "@nestjs/common";
import { CurrentSession } from "../identity/current-session.decorator";
import "../identity/request-context";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Resolves the authenticated identity's own (at most one, per SEC-13)
 * Organization membership — the web app's entry point for routing a
 * logged-in customer identity into their Organization's admin area without
 * the browser ever supplying an Organization id itself.
 */
@Controller("me/organization")
export class MyOrganizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  async get(@CurrentSession() ctx: { identity: { id: string } }) {
    const membership = await this.prisma.withContext({ isSystem: true }, (tx) =>
      tx.membership.findFirst({
        where: { identityId: ctx.identity.id, state: "ACTIVE" },
        include: { organization: { select: { id: true, name: true, accessStatus: true } } },
      })
    );
    if (!membership) throw new NotFoundException({ code: "no_organization_membership" });

    return {
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      organizationAccessStatus: membership.organization.accessStatus,
      membershipId: membership.id,
      profile: membership.profile,
      isOwner: membership.isOwner,
    };
  }
}
