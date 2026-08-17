import { describe, expect, it } from "vitest";
import { SessionService } from "./session.service";

// csrfTokenFor/verifyCsrfToken/isRecentlyAuthenticated are pure (no Prisma
// access), so a real PrismaService is unnecessary here.
const sessions = new SessionService(undefined as never);

describe("SessionService CSRF tokens (SEC-15)", () => {
  it("derives the same token for the same session id + secret, deterministically", () => {
    const a = sessions.csrfTokenFor("session-1", "secret-1");
    const b = sessions.csrfTokenFor("session-1", "secret-1");
    expect(a).toBe(b);
  });

  it("produces a different token for a different session id or secret", () => {
    const base = sessions.csrfTokenFor("session-1", "secret-1");
    expect(sessions.csrfTokenFor("session-2", "secret-1")).not.toBe(base);
    expect(sessions.csrfTokenFor("session-1", "secret-2")).not.toBe(base);
  });

  it("verifies a correctly derived token and rejects a forged one", () => {
    const token = sessions.csrfTokenFor("session-1", "secret-1");
    expect(sessions.verifyCsrfToken("session-1", "secret-1", token)).toBe(true);
    expect(sessions.verifyCsrfToken("session-1", "secret-1", "0".repeat(token.length))).toBe(false);
  });

  it("rejects a token from a different session's secret (cannot be replayed across sessions)", () => {
    const tokenForSessionA = sessions.csrfTokenFor("session-a", "secret-a");
    expect(sessions.verifyCsrfToken("session-b", "secret-b", tokenForSessionA)).toBe(false);
  });
});

describe("SessionService.isRecentlyAuthenticated (SEC-10)", () => {
  it("is true immediately after session creation", () => {
    expect(sessions.isRecentlyAuthenticated({ createdAt: new Date() })).toBe(true);
  });

  it("is false once the recent-auth window has elapsed", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    expect(sessions.isRecentlyAuthenticated({ createdAt: old })).toBe(false);
  });
});
