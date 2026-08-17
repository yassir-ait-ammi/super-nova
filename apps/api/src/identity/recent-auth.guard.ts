import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import "./request-context";
import { SessionService } from "./session.service";

/**
 * SEC-10: sensitive Platform Administrator interventions and lifecycle
 * transitions require a recently-authenticated session, not merely an
 * active one. Must run after SessionAuthGuard.
 */
@Injectable()
export class RecentAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const session = req.novaSession?.session;
    if (!session || !this.sessions.isRecentlyAuthenticated(session)) {
      throw new ForbiddenException("recent_authentication_required");
    }
    return true;
  }
}
