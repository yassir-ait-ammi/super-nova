import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authed, createPlatformAdmin, loginAs, uniqueSuffix } from "./helpers/fixtures";
import { createTestApp } from "./helpers/test-app";

const PASSWORD = "Correct-Harbor-Lighthouse-Beacon-9";

describe("first-party authentication", () => {
  let app: INestApplication;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    email = `auth-${uniqueSuffix()}@nova-test.local`;
    await createPlatformAdmin(app, email, PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in with correct credentials and sets a __Host- session cookie", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"]?.[0];
    expect(cookie).toContain("__Host-nova_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(res.body.csrfToken).toBeTruthy();
  });

  it("SEC-16: wrong password and unknown email return the identical neutral error", async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "definitely-the-wrong-password-000" });
    const unknownEmail = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: `nobody-${uniqueSuffix()}@nova-test.local`, password: "anything-at-all-000000" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
  });

  it("logout revokes the session so it can no longer authenticate protected routes", async () => {
    const session = await loginAs(app, email, PASSWORD);
    const me = await authed(app, session).get("/api/auth/me");
    expect(me.status).toBe(200);

    await authed(app, session).post("/api/auth/logout").expect(200);

    const meAfter = await authed(app, session).get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("SEC-15: an unsafe request without a valid CSRF header is rejected even with a valid session cookie", async () => {
    const session = await loginAs(app, email, PASSWORD);
    const res = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Cookie", session.cookie); // no x-nova-csrf header
    expect(res.status).toBe(403);
  });

  it("SEC-16: repeated failed logins are progressively throttled by account", async () => {
    const throttleEmail = `throttle-${uniqueSuffix()}@nova-test.local`;
    await createPlatformAdmin(app, throttleEmail, PASSWORD);

    const timedAttempt = async () => {
      const start = Date.now();
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ email: throttleEmail, password: "wrong-password-attempt-000" });
      return Date.now() - start;
    };

    // Burn through the free-attempt budget.
    for (let i = 0; i < 5; i += 1) await timedAttempt();
    const throttledDurationMs = await timedAttempt();

    expect(throttledDurationMs).toBeGreaterThanOrEqual(400);
  });

  it("GET /auth/me requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
