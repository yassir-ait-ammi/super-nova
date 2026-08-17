import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * High-entropy opaque secrets for invitations and password-reset tokens
 * (SEC-09/SEC-16: >=128 bits of entropy, hashed at rest, single-use).
 * 32 random bytes = 256 bits, comfortably above the floor.
 */
export function generateOpaqueSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Fast, deterministic hash for high-entropy random secrets (not user passwords — see password.ts for those). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

const ALGO = "aes-256-gcm";

/**
 * SEC-17: any delivery copy of an invitation/reset secret kept alongside the
 * outbox row (so the dispatcher can build the email link) is
 * application-encrypted under a key held only in the process environment,
 * never in the database. Ciphertext layout: iv(12) || authTag(16) || data.
 */
export function encryptForDelivery(base64Key: string, plaintext: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("EMAIL_PAYLOAD_ENC_KEY must decode to exactly 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptForDelivery(base64Key: string, payload: Buffer): string {
  const key = Buffer.from(base64Key, "base64");
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
