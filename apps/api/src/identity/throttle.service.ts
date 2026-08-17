import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const WINDOW_MS = 15 * 60 * 1000; // 15 minute lookback window
const FREE_ATTEMPTS = 5; // no delay for the first few attempts
const MAX_DELAY_MS = 30_000; // bounded — never approaches permanent denial of service

/**
 * SEC-16: bounded progressive-delay throttling by account AND by source,
 * so an attacker cannot bypass the limit by varying only one dimension.
 * Backed by Postgres (login_attempts) rather than in-memory state so the
 * limit survives process restarts and is verifiable in integration tests.
 */
@Injectable()
export class ThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  private computeDelayMs(failureCount: number): number {
    if (failureCount <= FREE_ATTEMPTS) return 0;
    const extra = failureCount - FREE_ATTEMPTS;
    return Math.min(MAX_DELAY_MS, 500 * 2 ** extra);
  }

  /** Returns the delay (ms) the caller must currently be waiting out, based on recent failures. */
  async currentDelayMs(normalizedEmail: string, ipAddress: string): Promise<number> {
    const since = new Date(Date.now() - WINDOW_MS);
    const [byEmail, byIp] = await Promise.all([
      this.prisma.client.loginAttempt.count({
        where: { normalizedEmail, succeeded: false, createdAt: { gte: since } },
      }),
      this.prisma.client.loginAttempt.count({
        where: { ipAddress, succeeded: false, createdAt: { gte: since } },
      }),
    ]);
    return Math.max(this.computeDelayMs(byEmail), this.computeDelayMs(byIp));
  }

  async record(normalizedEmail: string, ipAddress: string, succeeded: boolean): Promise<void> {
    await this.prisma.client.loginAttempt.create({
      data: { normalizedEmail, ipAddress, succeeded },
    });
  }
}
