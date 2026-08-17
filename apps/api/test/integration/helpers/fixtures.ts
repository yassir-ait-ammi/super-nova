import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { hashPassword } from "@nova/db";
import { normalizeEmail } from "@nova/shared";
import { PrismaService } from "../../../src/prisma/prisma.service";

let counter = 0;
/** Unique-per-call fixture suffix, so parallel/sequential tests never collide on unique constraints. */
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${process.pid}-${counter}`;
}

export async function createPlatformAdmin(
  app: INestApplication,
  email: string,
  password: string
): Promise<{ identityId: string }> {
  const prisma = app.get(PrismaService);
  const argon2Hash = await hashPassword(password);
  const identity = await prisma.client.identity.create({
    data: {
      normalizedEmail: normalizeEmail(email),
      displayEmail: email,
      passwordCredential: { create: { argon2Hash } },
      platformAdministrator: { create: {} },
    },
  });
  return { identityId: identity.id };
}

export async function createOrganization(
  app: INestApplication,
  params: { name: string; accessStatus?: "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DISABLED" }
): Promise<{ id: string }> {
  const prisma = app.get(PrismaService);
  const org = await prisma.withContext({ isPlatformAdmin: true }, (tx) =>
    tx.organization.create({
      data: {
        name: params.name,
        normalizedName: params.name.toLowerCase(),
        accessStatus: params.accessStatus ?? "ACTIVE",
      },
    })
  );
  return { id: org.id };
}

export interface AuthedSession {
  cookie: string;
  csrfToken: string;
}

export async function loginAs(app: INestApplication, email: string, password: string): Promise<AuthedSession> {
  const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password }).expect(200);
  const setCookie = res.headers["set-cookie"];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookieHeader) throw new Error("login did not set a session cookie");
  const cookie = cookieHeader.split(";")[0];
  return { cookie, csrfToken: res.body.csrfToken };
}

/** Wraps supertest so callers don't have to repeat cookie/CSRF header wiring on every unsafe request. */
export function authed(app: INestApplication, session: AuthedSession) {
  const agent = request(app.getHttpServer());
  return {
    get: (url: string) => agent.get(url).set("Cookie", session.cookie),
    post: (url: string) => agent.post(url).set("Cookie", session.cookie).set("x-nova-csrf", session.csrfToken),
    patch: (url: string) => agent.patch(url).set("Cookie", session.cookie).set("x-nova-csrf", session.csrfToken),
  };
}
