import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@nova/db";
import { encryptForDelivery } from "@nova/db";
import type { Env } from "../config/env";
import { EMAIL_TEMPLATES, EmailTemplateKey, TemplateVariablesFor } from "./templates";

export interface EnqueueEmailInput<K extends EmailTemplateKey> {
  organizationId?: string | null;
  templateKey: K;
  recipientEmail: string;
  variables: TemplateVariablesFor<K>;
  /** Plaintext invitation/reset secret. Encrypted immediately; never returned or logged. */
  secretToken: string;
}

/**
 * Writes the outbound-email intent in the SAME transaction as the business
 * mutation that caused it (invitation created, reset requested) — SEC-11.
 * The plaintext secret is application-encrypted before it ever touches a
 * column (SEC-17); the row's `variables` JSON holds only the fields the
 * template needs to render, never the token itself.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async enqueue<K extends EmailTemplateKey>(
    tx: Prisma.TransactionClient,
    input: EnqueueEmailInput<K>
  ): Promise<{ outboxId: string }> {
    const template = EMAIL_TEMPLATES[input.templateKey];
    const variables = template.variablesSchema.parse(input.variables);
    const encKey = this.config.get("EMAIL_PAYLOAD_ENC_KEY", { infer: true });
    const encryptedToken = encryptForDelivery(encKey, input.secretToken);

    const row = await tx.emailOutbox.create({
      data: {
        organizationId: input.organizationId ?? null,
        templateKey: input.templateKey,
        templateVersion: template.version,
        recipientEmail: input.recipientEmail,
        variables: variables as unknown as Prisma.InputJsonValue,
        encryptedToken,
      },
      select: { id: true },
    });

    return { outboxId: row.id };
  }
}
