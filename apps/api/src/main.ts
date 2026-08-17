import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import type { Env } from "./config/env";
import { EmailDispatcherService } from "./email/email-dispatcher.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });
  const config = app.get(ConfigService<Env, true>);

  // The web app proxies `/api/*` to this server (see apps/web/next.config.js),
  // which is what makes browser traffic genuinely same-origin (SEC-15).
  app.setGlobalPrefix("api");

  // Web and API are same-origin for browser traffic in production (SEC-15);
  // in local dev they run on different ports, so CORS is scoped to exactly
  // WEB_ORIGIN with credentials enabled for the session cookie.
  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
  });
  app.set("trust proxy", 1);

  // Recovery sweep for any email left PENDING from a prior process (SEC-11).
  await app.get(EmailDispatcherService).dispatchAllPending();

  const port = config.get("API_PORT", { infer: true });
  await app.listen(port);
  console.log(`[api] listening on :${port}`);
}

bootstrap();
