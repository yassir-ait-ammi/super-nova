/**
 * Canonical email normalization used everywhere an email is looked up or
 * compared (login, invitations, password reset, "one membership" checks).
 * Trims whitespace and lowercases — NOVA does not implement provider-specific
 * canonicalization (e.g. Gmail dot-stripping) since that would let one
 * identity claim mailbox addresses it does not exclusively control.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
