import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import "./request-context";

/** Must run after SessionAuthGuard. Narrow, separate capability — never implied by any tenant profile (SEC-10). */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const admin = req.novaSession?.identity.platformAdministrator;
    if (!admin || !admin.isActive) {
      throw new ForbiddenException("platform_admin_required");
    }
    return true;
  }
}
