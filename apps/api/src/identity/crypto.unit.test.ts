import { describe, expect, it } from "vitest";
import {
  decryptForDelivery,
  encryptForDelivery,
  generateOpaqueSecret,
  hashPassword,
  hashSecret,
  verifyPassword,
} from "@nova/db";

describe("password hashing (SEC-14: Argon2id)", () => {
  it("round-trips a correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("a-perfectly-fine-long-password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "a-perfectly-fine-long-password")).toBe(true);
    expect(await verifyPassword(hash, "not-the-right-password-at-all")).toBe(false);
  });

  it("encodes the required minimum parameters in the hash", async () => {
    const hash = await hashPassword("another-perfectly-fine-password");
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
  });

  it("never throws on a malformed/foreign hash — fails closed as 'no match'", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });

  it("generates a unique salt per call (two hashes of the same password differ)", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-both-times"), hashPassword("same-password-both-times")]);
    expect(a).not.toBe(b);
  });
});

describe("opaque secrets (SEC-09/SEC-16: >=128 bits entropy)", () => {
  it("generates secrets with at least 128 bits of entropy and no collisions across many calls", () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateOpaqueSecret()));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) {
      // base64url-encoded 32 bytes decodes back to >= 32 bytes = 256 bits.
      expect(Buffer.from(secret, "base64url").length).toBeGreaterThanOrEqual(32);
    }
  });

  it("hashes deterministically so a stored hash can be matched on lookup", () => {
    const secret = generateOpaqueSecret();
    expect(hashSecret(secret)).toBe(hashSecret(secret));
    expect(hashSecret(secret)).not.toBe(hashSecret(generateOpaqueSecret()));
  });
});

describe("application-layer delivery encryption (SEC-17)", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round-trips a plaintext token through encrypt/decrypt", () => {
    const plaintext = generateOpaqueSecret();
    const ciphertext = encryptForDelivery(key, plaintext);
    expect(decryptForDelivery(key, ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext on repeated calls (random IV)", () => {
    const plaintext = "same-plaintext-every-time";
    const first = encryptForDelivery(key, plaintext);
    const second = encryptForDelivery(key, plaintext);
    expect(first.equals(second)).toBe(false);
  });

  it("fails to decrypt with the wrong key (authenticated encryption catches tampering/wrong key)", () => {
    const wrongKey = Buffer.alloc(32, 9).toString("base64");
    const ciphertext = encryptForDelivery(key, "secret-value");
    expect(() => decryptForDelivery(wrongKey, ciphertext)).toThrow();
  });
});
