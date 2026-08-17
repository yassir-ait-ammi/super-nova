import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { EMAIL_PORT } from "./email-port";
import { EmailDispatcherService } from "./email-dispatcher.service";
import { GmailEmailAdapter } from "./gmail-email.adapter";
import { OutboxService } from "./outbox.service";
import { RecordingEmailAdapter } from "./recording-email.adapter";
import { ResendEmailAdapter } from "./resend-email.adapter";

@Module({
  imports: [ConfigModule],
  providers: [
    OutboxService,
    EmailDispatcherService,
    RecordingEmailAdapter,
    {
      provide: EMAIL_PORT,
      inject: [ConfigService, RecordingEmailAdapter],
      useFactory: (config: ConfigService<Env, true>, recording: RecordingEmailAdapter) => {
        const adapter = config.get("EMAIL_ADAPTER", { infer: true });
        if (adapter === "resend") return new ResendEmailAdapter(config);
        if (adapter === "gmail") return new GmailEmailAdapter(config);
        return recording;
      },
    },
  ],
  exports: [OutboxService, EmailDispatcherService, RecordingEmailAdapter, EMAIL_PORT],
})
export class EmailModule {}
