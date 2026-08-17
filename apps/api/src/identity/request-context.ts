import type { Identity, PlatformAdministrator, Session } from "@nova/db";

export interface AuthenticatedRequestContext {
  session: Session;
  identity: Identity & { platformAdministrator: PlatformAdministrator | null };
}

declare module "express" {
  interface Request {
    novaSession?: AuthenticatedRequestContext;
  }
}
