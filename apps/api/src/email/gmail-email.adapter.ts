import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";
import type { Env } from "../config/env";
import { EmailPort, EmailSendResult, RenderedEmail } from "./email-port";

/**
 * Sends through a real Gmail account over SMTP — the alternative to
 * ResendEmailAdapter for when you don't own a domain to verify with Resend
 * (Resend requires a verified sending domain/address; a personal Gmail
 * account needs neither).
 *
 * Requires 2-Step Verification enabled on the Google account and a
 * 16-character App Password minted at myaccount.google.com/apppasswords —
 * Gmail no longer accepts the account's normal login password for SMTP
 * ("less secure app access" was retired by Google). The address mail is
 * actually sent From is always the authenticated account (or a verified
 * alias) — unlike Resend, an arbitrary From address is not possible here;
 * only the display name is configurable (GMAIL_SENDER_NAME).
 */
@Injectable()
export class GmailEmailAdapter implements EmailPort {
  private readonly transporter: Transporter;
  private readonly senderEmail: string;
  private readonly senderName?: string;

  constructor(config: ConfigService<Env, true>) {
    const user = config.get("GMAIL_USER", { infer: true });
    const rawAppPassword = config.get("GMAIL_APP_PASSWORD", { infer: true });
    if (!user || !rawAppPassword) {
      throw new Error("GmailEmailAdapter requires GMAIL_USER and GMAIL_APP_PASSWORD");
    }
    this.senderEmail = user;
    this.senderName = config.get("GMAIL_SENDER_NAME", { infer: true });

    this.transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user,
        // App Passwords are shown by Google as "abcd efgh ijkl mnop" —
        // strip the spaces people naturally copy-paste along with it.
        pass: rawAppPassword.replace(/\s+/g, ""),
      },
    });
  }

  async send(email: RenderedEmail): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.senderName ? `"${this.senderName}" <${this.senderEmail}>` : this.senderEmail,
      to: email.recipientEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // Gmail/nodemailer has no first-class provider idempotency key (unlike
      // Resend's `idempotencyKey`); the outbox row's own
      // PENDING/SENT/FAILED state (outbox.service.ts) is what actually
      // prevents a double-send on retry for every adapter, this one included.
      headers: { "X-Nova-Idempotency-Key": email.idempotencyKey },
    });
    return { providerMessageId: info.messageId };
  }
}
