import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface CreatedSession {
  sessionId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHash("sha256").update(`${secret}:${message}`, "utf8").digest("hex");
}

/**
 * Owns server-side session lifecycle: opaque high-entropy tokens (>=128 bits
 * of entropy, SEC-15), hashed at rest, never stored or logged in plaintext.
 * The plaintext token is returned exactly once, at creation, for the caller
 * to place in the `__Host-` cookie.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private newOpaqueToken(): string {
    return base64url(randomBytes(32)); // 256 bits
  }

  private newCsrfSecret(): string {
    return base64url(randomBytes(32));
  }

  csrfTokenFor(sessionId: string, csrfSecret: string): string {
    return hmacSha256Hex(csrfSecret, sessionId);
  }

  verifyCsrfToken(sessionId: string, csrfSecret: string, provided: string): boolean {
    const expected = this.csrfTokenFor(sessionId, csrfSecret);
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  /** Always mints a brand-new session; never extends/reuses a client-supplied id (defeats fixation). */
  async create(identityId: string, meta: RequestMeta = {}): Promise<CreatedSession> {
    const token = this.newOpaqueToken();
    const csrfSecret = this.newCsrfSecret();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await this.prisma.client.session.create({
      data: {
        identityId,
        tokenHash: sha256Hex(token),
        csrfSecret,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      select: { id: true },
    });

    return {
      sessionId: session.id,
      token,
      csrfToken: this.csrfTokenFor(session.id, csrfSecret),
      expiresAt,
    };
  }

  /**
   * Validates a raw cookie token. Returns null for anything short of a
   * live, unexpired, unrevoked session belonging to a still-existing
   * identity — callers must treat null as "not authenticated" (fail closed).
   */
  async validate(token: string) {
    if (!token) return null;
    const tokenHash = sha256Hex(token);
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash },
      include: { identity: { include: { platformAdministrator: true } } },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;

    // Best-effort activity tracking; not security-relevant.
    void this.prisma.client.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return session;
  }

  isRecentlyAuthenticated(session: { createdAt: Date }): boolean {
    return Date.now() - session.createdAt.getTime() <= RECENT_AUTH_WINDOW_MS;
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** SEC-15: a completed password reset (and suspension/removal) revokes every session for the identity. */
  async revokeAllForIdentity(identityId: string, reason: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { identityId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
