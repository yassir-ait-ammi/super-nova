import * as argon2 from "argon2";

/**
 * SEC-14: Argon2id, unique library-generated salt per hash, at least
 * m=19456 KiB, t=2, p=1. `argon2.hash` generates a fresh random salt for
 * every call and encodes the algorithm/version/params in the returned
 * string, so verification never needs a separately stored parameter set.
 */
const ARGON2ID_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2ID_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // A malformed/foreign hash must never throw into caller auth logic —
    // treat it as "does not match" (fail closed).
    return false;
  }
}
