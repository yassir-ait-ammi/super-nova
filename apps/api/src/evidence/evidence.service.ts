import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@nova/db";

export interface RecordEvidenceInput {
  organizationId?: string | null;
  actorIdentityId?: string | null;
  actorIsPlatformAdmin: boolean;
  action: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
}

/**
 * SEC-11/SEC-12: minimized before/after evidence, always written in the same
 * transaction as the business mutation it documents, never containing
 * secrets/tokens/full payloads — callers pass only the fields needed to
 * prove the action occurred.
 */
@Injectable()
export class EvidenceService {
  async record(tx: Prisma.TransactionClient, input: RecordEvidenceInput): Promise<void> {
    await tx.adminEvidence.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorIdentityId: input.actorIdentityId ?? null,
        actorIsPlatformAdmin: input.actorIsPlatformAdmin,
        action: input.action,
        reason: input.reason ?? null,
        beforeState: (input.before as Prisma.InputJsonValue) ?? undefined,
        afterState: (input.after as Prisma.InputJsonValue) ?? undefined,
        correlationId: input.correlationId ?? randomUUID(),
      },
    });
  }
}
