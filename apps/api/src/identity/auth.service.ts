import { Injectable, UnauthorizedException } from "@nestjs/common";
import { hashPassword, verifyPassword } from "@nova/db";
import { normalizeEmail } from "@nova/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RequestMeta, SessionService } from "./session.service";
import { ThrottleService } from "./throttle.service";

// A real Argon2id hash of a fixed, non-secret placeholder value, computed
// once and cached — verifying against it on an identity-lookup miss costs
// roughly the same time as a genuine verification (SEC-16: no timing-based
// account enumeration). Must be a real hash (not a hand-written string) so
// argon2 actually performs the full memory-hard computation instead of
// failing fast on a malformed encoding.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("nova-timing-safety-placeholder-not-a-real-secret");
  }
  return dummyHashPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LoginResult {
  identityId: string;
  session: Awaited<ReturnType<SessionService["create"]>>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const normalizedEmail = normalizeEmail(email);
    const ip = meta.ipAddress ?? "unknown";

    const delayMs = await this.throttle.currentDelayMs(normalizedEmail, ip);
    if (delayMs > 0) await sleep(delayMs);

    const identity = await this.prisma.client.identity.findUnique({
      where: { normalizedEmail },
      include: { passwordCredential: true },
    });

    const hashToVerify = identity?.passwordCredential?.argon2Hash ?? (await getDummyHash());
    const passwordMatches = await verifyPassword(hashToVerify, password);
    const ok = Boolean(identity?.passwordCredential) && passwordMatches;

    await this.throttle.record(normalizedEmail, ip, ok);

    if (!ok || !identity) {
      throw new UnauthorizedException({ code: "invalid_credentials" });
    }

    const session = await this.sessions.create(identity.id, meta);
    return { identityId: identity.id, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, "logout");
  }

  /** Used only by the bootstrap script — never reachable over HTTP. */
  async createIdentityWithPassword(email: string, password: string): Promise<string> {
    const argon2Hash = await hashPassword(password);
    const identity = await this.prisma.client.identity.create({
      data: {
        normalizedEmail: normalizeEmail(email),
        displayEmail: email,
        passwordCredential: { create: { argon2Hash } },
      },
    });
    return identity.id;
  }
}
