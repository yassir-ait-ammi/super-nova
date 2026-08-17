import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { completePasswordResetSchema, loginSchema, registerSchema, requestPasswordResetSchema } from "@nova/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { clearSessionCookie, writeSessionCookie } from "./cookie.util";
import { CurrentSession } from "./current-session.decorator";
import { PasswordResetService } from "./password-reset.service";
import { RegistrationService } from "./registration.service";
import "./request-context";
import { SessionAuthGuard } from "./session-auth.guard";
import { SessionService } from "./session.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly passwordReset: PasswordResetService,
    private readonly registration: RegistrationService
  ) {}

  @Post("register")
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: { organizationName: string; email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.registration.register(body, requestMeta(req));
    writeSessionCookie(res, result.session.token);
    return {
      csrfToken: result.session.csrfToken,
      organizationId: result.organizationId,
      organizationName: result.organizationName,
    };
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const { session } = await this.auth.login(body.email, body.password, requestMeta(req));
    writeSessionCookie(res, session.token);
    return { csrfToken: session.csrfToken };
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(@CurrentSession() ctx: { session: { id: string } }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.session.id);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentSession() ctx: { identity: { id: string; displayEmail: string; platformAdministrator: unknown } }) {
    return {
      identityId: ctx.identity.id,
      email: ctx.identity.displayEmail,
      isPlatformAdministrator: Boolean(ctx.identity.platformAdministrator),
    };
  }

  /** Lets an already-authenticated client re-fetch its CSRF token (e.g. after a page reload). */
  @Get("csrf")
  @UseGuards(SessionAuthGuard)
  csrf(@CurrentSession() ctx: { session: { id: string; csrfSecret: string } }) {
    return { csrfToken: this.sessions.csrfTokenFor(ctx.session.id, ctx.session.csrfSecret) };
  }

  @Post("password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(@Body(new ZodValidationPipe(requestPasswordResetSchema)) body: { email: string }) {
    await this.passwordReset.request(body.email);
    // Always the same neutral response, whether or not the email exists (SEC-16).
    return { ok: true };
  }

  @Post("password-reset/complete")
  @HttpCode(200)
  async completePasswordReset(
    @Body(new ZodValidationPipe(completePasswordResetSchema)) body: { token: string; password: string }
  ) {
    await this.passwordReset.complete(body.token, body.password);
    return { ok: true };
  }
}
