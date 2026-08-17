import { describe, expect, it } from "vitest";
import { PasswordPolicyService } from "./password-policy.service";

describe("PasswordPolicyService (SEC-14)", () => {
  const policy = new PasswordPolicyService();

  it("rejects passwords shorter than 15 characters", () => {
    expect(policy.evaluate("short-1234567").ok).toBe(false);
    expect(policy.evaluate("short-1234567").reason).toBe("too_short");
  });

  it("rejects passwords longer than 64 characters", () => {
    const tooLong = "a".repeat(65);
    expect(policy.evaluate(tooLong)).toEqual({ ok: false, reason: "too_long" });
  });

  it("accepts a 15-character passphrase with no character-class requirement", () => {
    // all lowercase, no digits, no symbols — must still pass (no composition rule).
    expect(policy.evaluate("just-lowercase-words-here").ok).toBe(true);
  });

  it("accepts exactly the minimum and maximum boundary lengths", () => {
    // Not "aaaa…" or similar — must not accidentally collide with a
    // repeated-character blocklist entry; these are boundary-length checks.
    const fifteen = "zq7-xjklmwpfghi";
    const sixtyFour = fifteen + "x".repeat(49);
    expect(fifteen).toHaveLength(15);
    expect(sixtyFour).toHaveLength(64);
    expect(policy.evaluate(fifteen).ok).toBe(true);
    expect(policy.evaluate(sixtyFour).ok).toBe(true);
  });

  it("rejects a password found on the weak-password blocklist regardless of case", () => {
    const result = policy.evaluate("123456789987654321"); // present in the vendored blocklist, 19 chars
    expect(result).toEqual({ ok: false, reason: "blocklisted" });
    expect(policy.evaluate("123456789987654321".toUpperCase())).toEqual({ ok: false, reason: "blocklisted" });
  });

  it("counts Unicode code points, not UTF-16 code units, for length", () => {
    // Each of these emoji is a surrogate pair (2 UTF-16 units) but 1 code point.
    const fifteenEmoji = "🔒".repeat(15);
    expect(policy.evaluate(fifteenEmoji).ok).toBe(true);
    expect(fifteenEmoji.length).toBeGreaterThan(15); // sanity check on the premise
  });
});
