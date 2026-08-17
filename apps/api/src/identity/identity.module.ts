import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordPolicyService } from "./password-policy.service";
import { PasswordResetService } from "./password-reset.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { RecentAuthGuard } from "./recent-auth.guard";
import { RegistrationService } from "./registration.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { SessionService } from "./session.service";
import { ThrottleService } from "./throttle.service";

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    ThrottleService,
    PasswordPolicyService,
    PasswordResetService,
    RegistrationService,
    SessionAuthGuard,
    PlatformAdminGuard,
    RecentAuthGuard,
  ],
  exports: [
    AuthService,
    SessionService,
    ThrottleService,
    PasswordPolicyService,
    PasswordResetService,
    RegistrationService,
    SessionAuthGuard,
    PlatformAdminGuard,
    RecentAuthGuard,
  ],
})
export class IdentityModule {}
