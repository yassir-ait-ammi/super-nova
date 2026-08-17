import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import "./request-context";
import type { AuthenticatedRequestContext } from "./request-context";

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedRequestContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.novaSession) {
      throw new Error("CurrentSession used outside SessionAuthGuard");
    }
    return req.novaSession;
  }
);
