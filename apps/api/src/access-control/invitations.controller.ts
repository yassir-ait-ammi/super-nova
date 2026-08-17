import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { acceptExistingInvitationSchema, acceptInvitationSchema } from "@nova/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentSession } from "../identity/current-session.decorator";
import "../identity/request-context";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { writeSessionCookie } from "../identity/cookie.util";
import { SessionService } from "../identity/session.service";
import { InvitationsService } from "./invitations.service";

@Controller("invitations")
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService
  ) {}

  /**
   * Public by necessity (the caller has no session yet) — authorization is
   * entirely the possession of the high-entropy token, verified server-side
   * inside InvitationsService. Immediately issues a fresh session on
   * success so the browser is logged in as the newly activated owner.
   */
  @Post("accept")
  @HttpCode(200)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.invitations.acceptForNewIdentity(body.token, body.password);
    const session = await this.sessions.create(result.identityId, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    writeSessionCookie(res, session.token);
    return {
      organizationId: result.organizationId,
      organizationActivated: result.organizationActivated,
      csrfToken: session.csrfToken,
    };
  }

  /**
   * SEC-09: "an existing identity authenticates first" — this is that
   * second step. The caller's identity and normalized email come only from
   * their already-validated session, never from the request body.
   */
  @Post("accept-existing")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async acceptExisting(
    @Body(new ZodValidationPipe(acceptExistingInvitationSchema)) body: { token: string },
    @CurrentSession() ctx: { identity: { id: string; normalizedEmail: string } }
  ) {
    const result = await this.invitations.acceptForExistingIdentity(
      body.token,
      ctx.identity.id,
      ctx.identity.normalizedEmail
    );
    return { organizationId: result.organizationId, organizationActivated: result.organizationActivated };
  }
}
