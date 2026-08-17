import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authed, createPlatformAdmin, loginAs, uniqueSuffix } from "./helpers/fixtures";
import { createTestApp } from "./helpers/test-app";

const OLD_PASSWORD = "Original-Chosen-Password-000000";
const NEW_PASSWORD = "Brand-New-Chosen-Password-00000";

async function recordedResetToken(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).get(`/api/test-support/emails/latest?to=${encodeURIComponent(email)}`);
  expect(res.status).toBe(200);
  const match = res.body.text.match(/token=([^\s&"']+)/);
  const captured = match?.[1];
  if (!captured) throw new Error(`no token found in recorded email: ${res.body.text}`);
  return decodeURIComponent(captured);
}

describe("neutral password-reset flow", () => {
  let app: INestApplication;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    email = `reset-${uniqueSuffix()}@nova-test.local`;
    await createPlatformAdmin(app, email, OLD_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it("SEC-16: request always returns the same neutral response, known or unknown email", async () => {
    const known = await request(app.getHttpServer()).post("/api/auth/password-reset/request").send({ email });
    const unknown = await request(app.getHttpServer())
      .post("/api/auth/password-reset/request")
      .send({ email: `nobody-${uniqueSuffix()}@nova-test.local` });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it("completes the reset, revokes existing sessions, and allows login with the new password", async () => {
    const session = await loginAs(app, email, OLD_PASSWORD);
    await authed(app, session).get("/api/auth/me").expect(200);

    await request(app.getHttpServer()).post("/api/auth/password-reset/request").send({ email }).expect(200);
    const token = await recordedResetToken(app, email);

    await request(app.getHttpServer())
      .post("/api/auth/password-reset/complete")
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    // SEC-15: a completed reset revokes every existing session for the identity.
    const staleMe = await authed(app, session).get("/api/auth/me");
    expect(staleMe.status).toBe(401);

    const oldLogin = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: OLD_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app.getHttpServer()).post("/api/auth/login").send({ email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it("a reset token cannot be used twice", async () => {
    await request(app.getHttpServer()).post("/api/auth/password-reset/request").send({ email }).expect(200);
    const token = await recordedResetToken(app, email);

    await request(app.getHttpServer())
      .post("/api/auth/password-reset/complete")
      .send({ token, password: "First-Use-Password-000000000" })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post("/api/auth/password-reset/complete")
      .send({ token, password: "Second-Use-Attempted-000000" });
    expect(replay.status).toBe(404);
    expect(replay.body.code).toBe("invalid_or_expired_reset_token");
  });

  it("rejects a too-short password at the request-schema layer before it ever reaches business logic", async () => {
    await request(app.getHttpServer()).post("/api/auth/password-reset/request").send({ email }).expect(200);
    const token = await recordedResetToken(app, email);

    const res = await request(app.getHttpServer())
      .post("/api/auth/password-reset/complete")
      .send({ token, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("SEC-14: rejects a blocklisted password even though it satisfies the length requirement", async () => {
    await request(app.getHttpServer()).post("/api/auth/password-reset/request").send({ email }).expect(200);
    const token = await recordedResetToken(app, email);

    // 19 chars, satisfies DTO length rules, but is on the vendored weak-password blocklist.
    const res = await request(app.getHttpServer())
      .post("/api/auth/password-reset/complete")
      .send({ token, password: "123456789987654321" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("password_blocklisted");
  });
});
