import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nova/shared";

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: "too_short" | "too_long" | "blocklisted";
}

/**
 * SEC-14: length-only policy (15–64 Unicode chars, no composition rule, no
 * rotation), plus a maintained weak/compromised-password blocklist check.
 *
 * The blocklist is a vendored, offline snapshot (SecLists' NCSC breached
 * password corpus, filtered to entries >= PASSWORD_MIN_LENGTH) rather than a
 * live lookup service (e.g. HIBP's k-anonymity API): this is a deliberate
 * deviation, documented in SUBMISSION.md, so unit/integration/E2E tests stay
 * deterministic and offline in CI.
 */
@Injectable()
export class PasswordPolicyService {
  private readonly blocklist: Set<string>;

  constructor() {
    const path = join(__dirname, "data", "weak-password-blocklist.txt");
    const contents = readFileSync(path, "utf8");
    this.blocklist = new Set(
      contents
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0)
    );
  }

  evaluate(password: string): PasswordPolicyResult {
    const length = [...password].length; // count Unicode code points, not UTF-16 units
    if (length < PASSWORD_MIN_LENGTH) {
      return { ok: false, reason: "too_short" };
    }
    if (length > PASSWORD_MAX_LENGTH) {
      return { ok: false, reason: "too_long" };
    }
    if (this.blocklist.has(password.toLowerCase())) {
      return { ok: false, reason: "blocklisted" };
    }
    return { ok: true };
  }
}
