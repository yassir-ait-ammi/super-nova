import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Describes the server-resolved authority a database transaction runs
 * under. Every field here MUST be derived from authenticated server-side
 * state (session, DB-loaded membership) — never from a client-supplied
 * value (SEC-02).
 */
export interface TenantContext {
  /** The single Organization this transaction is scoped to, if any. */
  organizationId?: string | null;
  /** True only for an authenticated, currently-valid Platform Administrator. */
  isPlatformAdmin?: boolean;
  /**
   * True only for trusted, unauthenticated system flows with legitimately no
   * Organization/actor yet (login, password-reset request/completion,
   * new-identity invitation acceptance prior to session issuance).
   */
  isSystem?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a single Postgres transaction with the tenant context
 * applied via `SET LOCAL`, so every statement `fn` issues is subject to the
 * matching forced RLS policies. `SET LOCAL` is transaction-scoped by
 * Postgres itself, so a pooled connection reused for a later, differently
 * scoped transaction can never see a stale context (verified by the
 * cross-Organization integration tests).
 *
 * Missing/undefined context fields simply never get a `SET LOCAL`, which the
 * RLS policies (and app_current_org_id()'s NULL-on-unset behavior) treat as
 * "no access" — i.e. the system fails closed by default (SEC-05).
 */
export async function withTenantContext<T>(
  prisma: PrismaClient,
  context: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (context.organizationId !== undefined && context.organizationId !== null) {
    if (!UUID_RE.test(context.organizationId)) {
      throw new Error("Invalid tenant context: organizationId is not a UUID");
    }
  }

  return prisma.$transaction(async (tx) => {
    if (context.organizationId) {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${context.organizationId}'`);
    }
    if (context.isPlatformAdmin) {
      await tx.$executeRawUnsafe(`SET LOCAL app.is_platform_admin = 'true'`);
    }
    if (context.isSystem) {
      await tx.$executeRawUnsafe(`SET LOCAL app.is_system = 'true'`);
    }
    return fn(tx);
  });
}
