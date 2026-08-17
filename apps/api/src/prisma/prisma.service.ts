import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma, PrismaClient } from "@nova/db";
import { createAppPrismaClient, TenantContext, withTenantContext } from "@nova/db";
import type { Env } from "../config/env";

/**
 * Thin wrapper around the single runtime PrismaClient (nova_app role).
 * Every protected read/write MUST go through `withContext`, which opens a
 * transaction and applies the tenant context via `SET LOCAL` before running
 * the callback — this is what makes forced RLS actually apply (SEC-03).
 * There is deliberately no plain passthrough to the raw client for
 * unscoped queries.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public readonly client: PrismaClient;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.client = createAppPrismaClient(config.get("APP_DATABASE_URL", { infer: true }));
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  withContext<T>(context: TenantContext, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withTenantContext(this.client, context, fn);
  }
}
