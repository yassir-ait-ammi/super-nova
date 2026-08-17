import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { CSRF_HEADER_NAME } from "@nova/shared";
import { readSessionToken } from "./cookie.util";
import "./request-context";
import { SessionService } from "./session.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * NOVA's single source of authentication truth: every protected route goes
 * through this guard, which re-validates the session against the database
 * on every request (no trusted client-side claim, no stale in-process
 * cache) — so suspension/removal/expiry take effect immediately (SEC-07).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = readSessionToken(req);
    if (!token) throw new UnauthorizedException("not_authenticated");

    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException("not_authenticated");

    if (!SAFE_METHODS.has(req.method)) {
      const csrfHeader = req.headers[CSRF_HEADER_NAME];
      const provided = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!provided || !this.sessions.verifyCsrfToken(session.id, session.csrfSecret, provided)) {
        throw new ForbiddenException("csrf_check_failed");
      }
    }

    req.novaSession = { session, identity: session.identity };
    return true;
  }
}
