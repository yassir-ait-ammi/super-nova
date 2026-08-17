import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  createOrganizationSchema,
  organizationDirectoryQuerySchema,
  organizationLifecycleActionSchema,
  updateCommercialStatusSchema,
} from "@nova/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentSession } from "../identity/current-session.decorator";
import { PlatformAdminGuard } from "../identity/platform-admin.guard";
import { RecentAuthGuard } from "../identity/recent-auth.guard";
import "../identity/request-context";
import { SessionAuthGuard } from "../identity/session-auth.guard";
import { OrganizationsService } from "./organizations.service";

function correlationId(req: Request): string {
  const header = req.headers["x-correlation-id"];
  return (Array.isArray(header) ? header[0] : header) ?? "unknown";
}

@Controller("platform-admin/organizations")
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @UseGuards(RecentAuthGuard)
  async create(
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: { name: string; ownerEmail: string },
    @CurrentSession() ctx: { identity: { id: string } },
    @Req() req: Request
  ) {
    return this.organizations.create(body, { identityId: ctx.identity.id, correlationId: correlationId(req) });
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(organizationDirectoryQuerySchema))
    query: { search?: string; page: number; pageSize: number }
  ) {
    return this.organizations.list(query);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return this.organizations.get(id);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @UseGuards(RecentAuthGuard)
  async suspend(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(organizationLifecycleActionSchema)) body: { reason: string },
    @CurrentSession() ctx: { identity: { id: string } },
    @Req() req: Request
  ) {
    return this.organizations.suspend(id, body.reason, {
      identityId: ctx.identity.id,
      correlationId: correlationId(req),
    });
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @UseGuards(RecentAuthGuard)
  async reactivate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(organizationLifecycleActionSchema)) body: { reason: string },
    @CurrentSession() ctx: { identity: { id: string } },
    @Req() req: Request
  ) {
    return this.organizations.reactivate(id, body.reason, {
      identityId: ctx.identity.id,
      correlationId: correlationId(req),
    });
  }

  @Post(":id/disable")
  @HttpCode(200)
  @UseGuards(RecentAuthGuard)
  async disable(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(organizationLifecycleActionSchema)) body: { reason: string },
    @CurrentSession() ctx: { identity: { id: string } },
    @Req() req: Request
  ) {
    return this.organizations.disable(id, body.reason, {
      identityId: ctx.identity.id,
      correlationId: correlationId(req),
    });
  }

  @Patch(":id/commercial-status")
  @UseGuards(RecentAuthGuard)
  async updateCommercialStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCommercialStatusSchema))
    body: { commercialStatus: "DEMO" | "PILOT" | "ACTIVE"; reason: string },
    @CurrentSession() ctx: { identity: { id: string } },
    @Req() req: Request
  ) {
    return this.organizations.updateCommercialStatus(id, body.commercialStatus, body.reason, {
      identityId: ctx.identity.id,
      correlationId: correlationId(req),
    });
  }
}
