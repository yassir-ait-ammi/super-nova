import { Controller, Get, NotFoundException, Post, Query } from "@nestjs/common";
import { RecordingEmailAdapter } from "../email/recording-email.adapter";

/**
 * Test-only inspection surface over the deterministic RecordingEmailAdapter
 * (architecture: "automated tests must use the deterministic adapter... and
 * must not send external email"). This lets Playwright/integration tests
 * recover an invitation/reset link the same way a real mailbox would let a
 * human recover it — never from logs, the database, or a dev inbox.
 *
 * This controller only exists at all when TestSupportModule is imported,
 * which AppModule does exclusively when NODE_ENV === "test" (see
 * app.module.ts) — it is compiled out of any dev/production run.
 */
@Controller("test-support/emails")
export class TestSupportController {
  constructor(private readonly recording: RecordingEmailAdapter) {}

  @Get("latest")
  latest(@Query("to") to: string) {
    const email = this.recording.latestFor(to);
    if (!email) throw new NotFoundException({ code: "no_recorded_email" });
    return { subject: email.subject, html: email.html, text: email.text };
  }

  @Post("reset")
  reset() {
    this.recording.clear();
    return { ok: true };
  }
}
