import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EmailPort, EmailSendResult, RenderedEmail } from "./email-port";

/**
 * Deterministic, network-free adapter for automated tests (SEC/architecture
 * requirement: "automated tests must use the deterministic adapter ... and
 * must not send external email"). Captures every send in-memory so tests can
 * assert on it directly — including recovering the invitation/reset link
 * from the rendered HTML/text, since these test doubles need it to drive
 * Playwright through the real journey without a real mailbox.
 */
@Injectable()
export class RecordingEmailAdapter implements EmailPort {
  private readonly sent: RenderedEmail[] = [];

  async send(email: RenderedEmail): Promise<EmailSendResult> {
    this.sent.push(email);
    return { providerMessageId: `recorded-${randomUUID()}` };
  }

  all(): readonly RenderedEmail[] {
    return this.sent;
  }

  latestFor(recipientEmail: string): RenderedEmail | undefined {
    return [...this.sent].reverse().find((e) => e.recipientEmail === recipientEmail);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
