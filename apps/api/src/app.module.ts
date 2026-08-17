import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { AccessControlModule } from "./access-control/access-control.module";
import { SafeExceptionFilter } from "./common/filters/safe-exception.filter";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";
import { loadEnv } from "./config/env";
import { EmailModule } from "./email/email.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { IdentityModule } from "./identity/identity.module";
import { OrganizationAdminModule } from "./organization-admin/organization-admin.module";
import { PlatformAdminModule } from "./platform-admin/platform-admin.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TestSupportModule } from "./test-support/test-support.module";

// Test-only email inspection surface (see test-support.controller.ts) — only
// ever registered under NODE_ENV=test, so it cannot exist in a dev/prod build.
const testOnlyModules = process.env.NODE_ENV === "test" ? [TestSupportModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    PrismaModule,
    EvidenceModule,
    EmailModule,
    IdentityModule,
    AccessControlModule,
    OrganizationAdminModule,
    PlatformAdminModule,
    ...testOnlyModules,
  ],
  providers: [{ provide: APP_FILTER, useClass: SafeExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
