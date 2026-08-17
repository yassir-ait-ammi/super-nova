export interface RenderedEmail {
  recipientEmail: string;
  subject: string;
  html: string;
  text: string;
  /** Idempotency key for the outbound provider — the outbox row id, so retries never double-send. */
  idempotencyKey: string;
}

export interface EmailSendResult {
  providerMessageId: string;
}

/**
 * The only door out to email. Adapters receive fully-rendered, already
 * allowlisted content — they never see a template name the caller chose
 * freely, never accept an arbitrary sender, and never accept an arbitrary
 * recipient-redirect origin (SEC-17).
 */
export const EMAIL_PORT = Symbol("EMAIL_PORT");

export interface EmailPort {
  send(email: RenderedEmail): Promise<EmailSendResult>;
}
