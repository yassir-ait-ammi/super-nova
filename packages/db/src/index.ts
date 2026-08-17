import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export * from "./tenant-context";
export * from "./password";
export * from "./crypto";

/**
 * Creates the single PrismaClient used by the running API. It MUST be
 * constructed with APP_DATABASE_URL (the nova_app role) — never the
 * migrator URL — so every query is subject to forced RLS (SEC-03).
 */
export function createAppPrismaClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) {
    throw new Error("createAppPrismaClient requires a database URL");
  }
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
}
