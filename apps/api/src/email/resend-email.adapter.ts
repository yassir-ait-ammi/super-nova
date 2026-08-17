import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import type { Env } from "../config/env";
import { EmailPort, EmailSendResult, RenderedEmail } from "./email-port";

@Injectable()
export class ResendEmailAdapter implements EmailPort {
  private readonly client: Resend;
  private readonly senderEmail: string;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get("RESEND_API_KEY", { infer: true });
    const senderEmail = config.get("RESEND_SENDER_EMAIL", { infer: true });
    if (!apiKey || !senderEmail) {
      throw new Error("ResendEmailAdapter requires RESEND_API_KEY and RESEND_SENDER_EMAIL");
    }
    this.client = new Resend(apiKey);
    this.senderEmail = senderEmail;
  }

  async send(email: RenderedEmail): Promise<EmailSendResult> {
    const result = await this.client.emails.send(
      {
        from: this.senderEmail,
        to: email.recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      { idempotencyKey: email.idempotencyKey }
    );
    if (result.error || !result.data) {
      throw new Error(`Resend delivery failed: ${result.error?.message ?? "unknown error"}`);
    }
    return { providerMessageId: result.data.id };
  }
}
