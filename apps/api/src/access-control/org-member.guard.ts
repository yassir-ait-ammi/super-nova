import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import "../identity/request-context";
import { PrismaService } from "../prisma/prisma.service";
import { capabilitiesFromRows } from "./org-context";
import "./org-context";

/**
 * Resolves :organizationId from the route — a request parameter at most
 * (SEC-02) — into the caller's own ACTIVE membership row, looked up by
 * their authenticated identity, never trusted from the URL alone. No
 * membership (wrong org, suspended, removed, or the org doesn't exist)
 * produces the same neutral 404 (SEC-06) — an unauthorized caller cannot
 * distinguish "not your org" from "no such org". Must run after
 * SessionAuthGuard.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rawOrganizationId = req.params.organizationId;
    const organizationId = Array.isArray(rawOrganizationId) ? rawOrganizationId[0] : rawOrganizationId;
    const identityId = req.novaSession?.identity.id;
    if (!organizationId || !identityId) throw new NotFoundException({ code: "organization_not_found" });

    const membership = await this.prisma.withContext({ organizationId }, (tx) =>
      tx.membership.findFirst({
        where: { organizationId, identityId, state: "ACTIVE" },
        include: { capabilities: true },
      })
    );

    if (!membership) throw new NotFoundException({ code: "organization_not_found" });

    req.novaOrgMember = { membership, capabilities: capabilitiesFromRows(membership.capabilities) };
    return true;
  }
}
