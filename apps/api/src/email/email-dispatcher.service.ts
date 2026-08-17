import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptForDelivery, type EmailOutboxStatus } from "@nova/db";
import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { EMAIL_PORT, EmailPort } from "./email-port";
import { EMAIL_TEMPLATES, EmailTemplateKey } from "./templates";

const MAX_ATTEMPTS = 5;

interface OutboxRow {
  id: string;
  template_key: EmailTemplateKey;
  recipient_email: string;
  variables: unknown;
  encrypted_token: Buffer | null;
  status: EmailOutboxStatus;
  attempts: number;
}

/**
 * Sends whatever is PENDING in the outbox. Called synchronously right after
 * the enqueuing transaction commits (architecture ยง6 allows either
 * synchronous send-after-commit or an outbox+dispatcher; we use both: a
 * synchronous attempt for low latency, plus `dispatchAllPending` run at
 * startup so nothing durable is ever silently lost if the process was
 * killed between commit and send).
 */
@Injectable()
export class EmailDispatcherService {
  private readonly logger = new Logger(EmailDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort
  ) {}

  async dispatchOne(outboxId: string): Promise<void> {
    await this.prisma.withContext({ isSystem: true }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<OutboxRow[]>(
        `SELECT id, template_key, recipient_email, variables, encrypted_token, status, attempts
         FROM email_outbox WHERE id = $1::uuid FOR UPDATE`,
        outboxId
      );
      const row = rows[0];
      if (!row || row.status !== "PENDING") return; // already handled — idempotent no-op

      const encKey = this.config.get("EMAIL_PAYLOAD_ENC_KEY", { infer: true });
      const webOrigin = this.config.get("WEB_ORIGIN", { infer: true });

      try {
        if (!row.encrypted_token) {
          throw new Error("missing_delivery_payload");
        }
        const token = decryptForDelivery(encKey, row.encrypted_token);
        const template = EMAIL_TEMPLATES[row.template_key];
        const variables = template.variablesSchema.parse(row.variables);
        const link = `${webOrigin}${template.linkPath(token)}`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rendered = (template.render as any)(variables, link);

        const result = await this.emailPort.send({
          recipientEmail: row.recipient_email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: row.id,
        });

        await tx.$executeRawUnsafe(
          `UPDATE email_outbox SET status = 'SENT', resend_message_id = $2, sent_at = now(), encrypted_token = NULL, attempts = attempts + 1 WHERE id = $1::uuid`,
          row.id,
          result.providerMessageId
        );
      } catch {
        // Deliberately not inspecting the error's message/stack here — only
        // a safe, minimized code is ever persisted or logged (SEC-12).
        const attempts = row.attempts + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        const safeCode = terminal ? "delivery_failed_terminal" : "delivery_failed_retryable";
        this.logger.warn(`email outbox ${row.id} attempt ${attempts} failed: ${safeCode}`);
        await tx.$executeRawUnsafe(
          `UPDATE email_outbox SET status = $2::"email_outbox_status", attempts = $3, last_error_code = $4, encrypted_token = CASE WHEN $5::boolean THEN NULL ELSE encrypted_token END WHERE id = $1::uuid`,
          row.id,
          terminal ? "FAILED" : "PENDING",
          attempts,
          safeCode,
          terminal
        );
      }
    });
  }

  /** Recovery sweep for anything left PENDING (e.g. process restart between commit and send). */
  async dispatchAllPending(limit = 50): Promise<number> {
    const pending = await this.prisma.withContext({ isSystem: true }, (tx) =>
      tx.emailOutbox.findMany({
        where: { status: "PENDING" },
        select: { id: true },
        take: limit,
        orderBy: { createdAt: "asc" },
      })
    );
    for (const row of pending) {
      await this.dispatchOne(row.id);
    }
    return pending.length;
  }
}
