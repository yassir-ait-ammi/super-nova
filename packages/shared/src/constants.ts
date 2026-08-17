/** Name of the session cookie. `__Host-` prefix requires Secure, Path=/, no Domain (SEC-15). */
export const SESSION_COOKIE_NAME = "__Host-nova_session";

/** Header the browser must send the CSRF token in for unsafe requests. */
export const CSRF_HEADER_NAME = "x-nova-csrf";

/** Single-factor password policy (SEC-14): no composition rules, length-based only. */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 64;

/** Invitation lifetime (SEC-09). */
export const INVITATION_TTL_DAYS = 7;

/** Ownership-transfer proposal lifetime — not specified exactly by the assessment; matches the invitation window as a reasonable default. */
export const OWNERSHIP_TRANSFER_TTL_DAYS = 7;

/** Password-reset token lifetime (SEC-16 / architecture section 5). */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Minimum entropy (bits) required of invitation/reset/session secrets. */
export const MIN_SECRET_ENTROPY_BITS = 128;

export const ORGANIZATION_PROFILES = ["ADMINISTRATOR", "USER"] as const;
export type OrganizationProfile = (typeof ORGANIZATION_PROFILES)[number];
