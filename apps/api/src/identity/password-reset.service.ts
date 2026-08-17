import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { generateOpaqueSecret, hashPassword, hashSecret } from "@nova/db";
import { normalizeEmail, PASSWORD_RESET_TTL_MINUTES } from "@nova/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EmailDispatcherService } from "../email/email-dispatcher.service";
import { OutboxService } from "../email/outbox.service";
import { PasswordPolicyService } from "./password-policy.service";

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly dispatcher: EmailDispatcherService,
    private readonly passwordPolicy: PasswordPolicyService
  ) {}

  /** SEC-16: always returns void / a neutral outcome — never reveals whether the email exists. */
  async request(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const identity = await this.prisma.client.identity.findUnique({ where: { normalizedEmail } });
    if (!identity) return; // neutral no-op

    const token = generateOpaqueSecret();
    const tokenHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    const outboxId = await this.prisma.withContext({ isSystem: true }, async (tx) => {
      // Invalidate any still-pending prior reset tokens for this identity.
      await tx.passwordResetToken.updateMany({
        where: { identityId: identity.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: { identityId: identity.id, tokenHash, expiresAt },
      });

      const { outboxId } = await this.outbox.enqueue(tx, {
        organizationId: null,
        templateKey: "PASSWORD_RESET",
        recipientEmail: identity.displayEmail,
        variables: { expiresAt: expiresAt.toISOString() },
        secretToken: token,
      });
      return outboxId;
    });

    await this.dispatcher.dispatchOne(outboxId).catch(() => undefined);
  }

  async complete(rawToken: string, newPassword: string): Promise<{ identityId: string }> {
    const passwordCheck = this.passwordPolicy.evaluate(newPassword);
    if (!passwordCheck.ok) {
      throw new BadRequestException({ code: `password_${passwordCheck.reason}` });
    }
    const tokenHash = hashSecret(rawToken);

    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; identity_id: string; used_at: Date | null; revoked_at: Date | null; expires_at: Date }>
      >`SELECT id, identity_id, used_at, revoked_at, expires_at FROM password_reset_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
      const resetToken = rows[0];

      if (!resetToken || resetToken.used_at || resetToken.revoked_at) {
        throw new NotFoundException({ code: "invalid_or_expired_reset_token" });
      }
      if (resetToken.expires_at.getTime() <= Date.now()) {
        throw new NotFoundException({ code: "invalid_or_expired_reset_token" });
      }

      const argon2Hash = await hashPassword(newPassword);
      await tx.passwordCredential.update({
        where: { identityId: resetToken.identity_id },
        data: { argon2Hash, passwordChangedAt: new Date() },
      });
      await tx.$executeRaw`UPDATE password_reset_tokens SET used_at = now() WHERE id = ${resetToken.id}::uuid`;

      // SEC-15: a completed password reset revokes every existing session for the identity.
      await tx.session.updateMany({
        where: { identityId: resetToken.identity_id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "password_reset" },
      });

      return { identityId: resetToken.identity_id };
    });
  }
}
