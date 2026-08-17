import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/prisma/prisma.service";

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  // Login throttling is intentionally keyed by source address as well as
  // account (SEC-16), and every request in this in-process suite shares one
  // loopback address — without this, a later file's logins would inherit
  // throttling delay from an earlier file's intentional failed-login test.
  // Each test *file* gets a clean throttle window; the throttling behavior
  // itself is still exercised end-to-end within auth.test.ts.
  await app.get(PrismaService).client.loginAttempt.deleteMany({});

  return app;
}
