# SUBMISSION — NOVA

## Status

Both required modules are implemented end to end and runnable from a clean clone: **SaaS
Foundation & Platform Administration** and **Client-side Collaborative Administration**.

**Delivered:**
- Monorepo (pnpm + Turborepo), strict TypeScript everywhere.
- Full Prisma schema for both modules with hand-reviewed SQL migrations enforcing forced
  PostgreSQL row-level security on every tenant-owned table (schema-audited by an integration
  test that discovers tenant tables from the schema itself, not a hand-maintained list).
- First-party email/password authentication: Argon2id, opaque `__Host-` sessions, CSRF
  protection, durable progressive-delay login throttling, neutral responses, secure idempotent
  Platform Administrator bootstrap.
- Organization provisioning, real Resend-backed initial-owner invitation, atomic activation on
  acceptance, minimized platform directory, suspend/reactivate/terminal-disable with evidence,
  independent commercial status.
- Neutral, single-use, 30-minute password-reset flow; a completed reset revokes every session.
- Company and Business Scope administration: create/edit/deactivate Companies with cascade
  protection, a guided duplicate-aware Business Scope creation flow, and grant-scoped visibility
  (a `User` sees only Companies/Scopes they were explicitly granted; an `Administrator` sees
  everything by profile).
- Collaborator invitations (issued by an Organization Administrator, not a Platform
  Administrator) with explicit capabilities and scope grants resolved from editable permission
  presets; resend/revoke/accept, including the "existing identity authenticates first" path.
- Collaborator suspension, reactivation, and logical removal (history preserved, never deleted),
  each with immediate server-side session revocation.
- Administrator promotion (owner-only, distinct sensitive action, session-rotating) and atomic
  ownership transfer (propose/accept/cancel, exactly one owner at all times, former owner remains
  an Administrator).
- Advanced Platform Administrator control-plane actions: Organization suspend/reactivate/
  terminal-disable with recent-authentication + reason + evidence, immediate session revocation
  for every affected member, independent commercial-status changes.
- 94 automated tests, all green: 21 unit, 57 integration (real Postgres, including the forced-RLS
  negative suite, cross-Organization authorization checks, and a dedicated concurrency suite for
  the last-Administrator/owner-continuity invariant), 16 Playwright E2E (desktop + 360px, both
  required critical journeys plus dedicated responsive/keyboard coverage of every authenticated
  page). CI runs the full pipeline on every push.

**Not yet delivered / deferred, reported honestly:**
- The Loom demonstration video has not been recorded yet (pending — see below).
- Business Scope "sector-specific counterpart" (an optional Context-only field mentioned in the
  product requirements, not required for the assessment) was not modeled.
- No dedicated UI for browsing `AdminEvidence` records — evidence is written correctly and
  verified by tests, but there is no admin screen to read it back (not required by the assessment).

This is stated honestly per the assessment's own instruction to report scope truthfully.

## AI-assisted workflow

Built with Claude Code across one extended, plan-then-execute session: an explicit written plan
was reviewed and approved before any code was written, then executed as vertical slices — schema
and RLS first (verified with direct `SET LOCAL`/transaction probes against Postgres before
anything else was trusted), then Identity/Auth, Email, Platform Administration, and finally
Access Control + Organization Administration (Companies/Scopes/collaborators/promotion/ownership
transfer). Every module was smoke-tested manually (curl, then a headless/real browser) before its
automated tests were written, and every new RLS policy was verified with direct psql-level probes.

The automated test suite caught real defects during development, each confirmed fixed by rerunning
the suite rather than assumed fixed: a raw-SQL `uuid = text` cast error; an RLS policy that wrongly
blocked the invitation-acceptance Organization-activation path; a Vitest/esbuild
decorator-metadata gap that silently broke NestJS dependency injection (fixed with `unplugin-swc`);
a module wiring gap where a re-exported module's guards weren't resolvable in a sibling module; an
RLS policy gap blocking the "resolve my own Organization" self-lookup query; a generic-`{}`
fallback in the API client silently corrupting a legitimate `null` JSON response into a truthy
empty object (fixed by having the endpoint return a wrapper object instead of a bare `null`); and
two E2E test bugs (Playwright pages sharing a browser context — and therefore cookies — silently
logged one simulated user out from under another; a missing `waitForURL` created a login/navigation
race). All were root-caused via the actual error/log output, not guessed at.

A real SEC-08 concurrency bug was found and fixed in a later review pass, specifically by writing
adversarial tests for scenarios beyond the ones already covered: `test/integration/last-administrator-invariant.test.ts`
fires genuinely concurrent (`Promise.all`) requests rather than sequential ones. One of the three
new tests — a concurrent ownership-transfer acceptance racing a suspend of the same successor —
failed on ~11 of 15 runs before the fix (not a one-off flake), reproducibly leaving a membership
row with `isOwner=true` and `state=SUSPENDED`: a "suspended owner," which is a real violation of
"an active Organization has exactly one active owner" even though the boolean flags looked
individually valid. Root cause: neither `acceptOwnershipTransfer`'s read of the successor nor
`transitionState`'s (suspend/reactivate/remove) read of the target membership held a row lock, so
both transactions could read pre-conflict state and both commit. Fixed by `SELECT ... FOR UPDATE`
locking the relevant membership row(s) before reading them in both paths, in a consistent lock
order (proposer before successor) to avoid introducing a deadlock between the two code paths.
Re-verified with 25 consecutive runs of the new test file (0 failures) plus 3 consecutive full
integration-suite runs (57/57 each time).

## Validation strategy

- **Unit** (`pnpm test:unit`, no database): password policy/blocklist/Unicode-length handling,
  Argon2id round-trip and parameter encoding, opaque-secret entropy/uniqueness, CSRF token
  derivation and cross-session non-reuse, application-layer AES-GCM delivery encryption.
- **Integration** (`pnpm test:integration`, real Postgres, `nova_test`):
  - forced-RLS isolation: two Organizations, missing/malformed context, a reused pooled
    connection alternating tenants, a forged `organization_id` on insert, and a schema-driven
    audit that every table carrying `organization_id` (plus `organizations` itself) enables and
    forces RLS — this fails automatically if a future table is added without RLS;
  - full invitation lifecycle (initial-owner and collaborator) including concurrent-accept races,
    expiry boundaries, resend/revoke, and the SEC-13 "one Organization membership" rule (including
    reuse of a former membership on re-invitation and rejection of a second Organization);
  - Company/Business Scope creation, duplicate detection (including a concurrent-duplicate race),
    cascade-blocked deactivation, and grant-scoped visibility for `User` profiles;
  - collaborator suspension/reactivation/removal, the owner-cannot-be-suspended-or-removed rule,
    the last-active-Administrator guard, promotion (owner-only, session-rotating), and the full
    ownership-transfer state machine (single pending proposal per Organization, successor
    eligibility, proposer re-verification at acceptance, cancellation, wrong-successor rejection);
  - SEC-08 under genuine concurrency (`last-administrator-invariant.test.ts`, `Promise.all`-fired
    requests, not sequential): concurrently removing every non-owner Administrator never drops an
    active Organization below one active Administrator; racing a promotion against a suspend of
    the same target never leaves an inconsistent profile/state row; racing an ownership-transfer
    acceptance against a suspend of the same successor never installs a suspended member as owner;
  - login neutrality/throttling, CSRF enforcement, Organization lifecycle transitions with
    evidence and immediate session revocation, and the full password-reset flow;
  - cross-Organization authorization: a member of Organization A gets the same neutral 404 as a
    nonexistent Organization when addressing Organization B by forged id, on every
    organization-scoped route family (companies, business scopes, members, forged parent-child
    references).
- **End-to-end** (`pnpm test:e2e`, Playwright, real browser + real built API): the full Platform
  Administration critical journey (bootstrap → provision → real transactional email → invitation
  acceptance → replay refusal → login/logout → password reset) and the full Collaborative
  Administration critical journey (Company/Business Scope creation → collaborator invite/accept
  with explicit grants → suspend → remove; and separately, promotion → ownership-transfer
  propose/accept) — each at both desktop and 360px viewports, plus a keyboard-operability check.
- **CI**: GitHub Actions runs lint → typecheck → unit → integration → Playwright install → build →
  E2E on every push, against a dedicated ephemeral Postgres service matching the committed
  `.env.test`.

## Architecture notes

- **Tenant context**: every protected database transaction is opened via
  `PrismaService.withContext({ organizationId?, isPlatformAdmin?, isSystem? }, fn)`
  (`apps/api/src/prisma/prisma.service.ts` → `packages/db/src/tenant-context.ts`), which issues
  `SET LOCAL app.org_id` / `app.is_platform_admin` / `app.is_system` before running `fn`. Missing
  context simply never sets those variables, and the RLS policies treat that as "no access" —
  fail-closed by construction, not by convention.
- **`app.is_system`**: a third context flag beyond org-scoped and platform-admin, for legitimately
  pre-authenticated or "resolve my own single row" flows (login, password-reset request/
  completion, invitation-token lookup by a new identity before any session exists, and an
  authenticated identity resolving which Organization it belongs to before `app.org_id` is known).
  Set only by trusted server-side code paths, never derived from request input, and scoped
  narrowly per-table (SELECT-only where used) rather than granted as a blanket bypass.
- **Two Postgres roles**: `nova_migrator` (schema owner, `BYPASSRLS` — a migration/seed/CI-only
  credential never used by the running API) and `nova_app` (the sole runtime credential:
  `NOSUPERUSER NOBYPASSRLS`, owns nothing, granted access only through forced RLS policies, with
  `ALTER DEFAULT PRIVILEGES` so every future migration-created table is automatically grant-ready).
- **Within-tenant visibility vs. tenant isolation**: RLS enforces the Organization boundary
  (SEC-01); which Companies/Business Scopes a specific `User` can see within their own
  Organization is an application-layer concern (`EffectiveAccessService`), not encoded in RLS
  policies — Company-level grants descend to their Scopes, Scope-level grants never ascend to the
  parent Company, matching FR-116. This is a deliberate scoping choice: RLS's job is the
  cross-Organization leak that is a blocking gate; within-tenant grant filtering doesn't need
  database-level enforcement to meet that bar, and keeping it in the application layer avoids
  encoding preset/grant logic into SQL policies for negligible additional protection.
- **Deliberate deviation — weak-password blocklist**: SEC-14 asks for a check against a
  "maintained weak/compromised-password blocklist." A live k-anonymity service (e.g. HIBP) would
  add a network dependency to every password submission and make tests non-deterministic; instead
  the blocklist is a vendored, offline snapshot (SecLists' NCSC breached-password corpus, filtered
  to entries ≥15 characters) checked locally.
- **Email delivery**: `EmailModule` defines an allowlisted, versioned template registry with
  zod-validated non-secret variables. The invitation/reset secret is never stored in the
  `email_outbox.variables` JSON; it is application-encrypted (AES-256-GCM, key held only in
  `EMAIL_PAYLOAD_ENC_KEY`, never in the database) into a separate column, decrypted only
  transiently by the dispatcher at send time, and cleared immediately on success or terminal
  failure (SEC-17). Delivery is synchronous after the enqueuing transaction commits, with a
  startup recovery sweep for anything left `PENDING` — satisfying outbox reliability without
  Redis/BullMQ/a separate worker. Collaborator invitations carry their intended
  capabilities/scope grants as `pendingGrants` on the `Invitation` row, applied to the Membership
  atomically on acceptance and re-validated against currently-active Companies/Scopes at that
  moment (a grant for something deactivated since the invite was sent is silently dropped, never
  resurrected — matching FR-089's "never resurrects removed or inactive grants").
- **Ownership transfer**: a dedicated `OwnershipTransferProposal` table (not fields bolted onto
  `Organization`) with a partial-unique index enforcing at most one `PENDING` proposal per
  Organization, a 7-day freshness window (not specified exactly by the assessment; matches the
  invitation TTL as a reasonable default), and acceptance implemented as two sequential `UPDATE`s
  inside one row-locked transaction (old owner → `false`, then new owner → `true`) so the "at most
  one active owner" unique index is never transiently violated.
- **Organization creation vs. invitation are two transactions, not one**, and **Company creation
  vs. Business Scope creation are always separate transactions**: each step commits independently
  with its own evidence; a failure partway through leaves a valid, resumable intermediate state
  rather than an all-or-nothing rollback across unrelated concerns.
- **Test-only email inspection**: `apps/api/src/test-support/` exposes
  `GET /test-support/emails/latest?to=` over the same deterministic `RecordingEmailAdapter` the
  architecture requires automated tests to use. Registered in `AppModule` **only** when
  `NODE_ENV=test` — absent from any dev/production build — which is how both the integration
  suite and Playwright recover real invitation/reset links without a mailbox.
- **Session duration**: 12 hours, fixed at creation (not sliding) — a reasonable default, not a
  value the assessment specifies.

## Beyond the assessment

After the graded scope above was complete, a self-service registration flow was added at the
requester's request, purely for a friendlier onboarding experience — it is **not** part of the
required assessment functionality and doesn't change anything about it.

- `POST /auth/register` / `/register` (web): a brand-new Identity supplies an Organization name,
  email, and password, and gets an `ACTIVE` Organization plus an owner `Administrator` Membership
  and a live session, all in one request — no `PROVISIONING` step, no invitation email.
- Deliberately reuses the existing primitives rather than inventing new ones: same
  `PasswordPolicyService` check, same `EvidenceService` records (`ORGANIZATION_SELF_REGISTERED`,
  `OWNER_MEMBERSHIP_CREATED`), same `SessionService.create`, and the same "resolve an
  Organization id at runtime, then `SET LOCAL app.org_id` mid-transaction" pattern already used by
  `invitations.service.ts`'s `acceptCore`.
- The one new trust decision: `RegistrationService.register` opens its transaction with
  `{ isPlatformAdmin: true }` so the insert satisfies `organizations_insert`'s RLS policy, the same
  policy the Platform Administrator console relies on. This is a server-side-only code path never
  reachable from request input beyond the three form fields — it grants the new identity no
  standing platform-admin capability, only permission for this one transaction to create its own
  Organization row.
- The original invitation-based provisioning path (Platform Administrator → initial-owner
  invitation → activation on acceptance) is untouched and still the only path for a Platform
  Administrator to provision an Organization on someone else's behalf.
- Not covered by new automated tests (unit/integration/E2E) — this was built to the "portfolio
  polish" bar, not the assessment's test-coverage bar. If this were going back into graded scope,
  it would need the same integration coverage as `acceptForNewIdentity` (duplicate email/name
  races, password-policy rejection, RLS-context correctness) before being trusted at that level.

A second, unrelated addition: a **Gmail SMTP email adapter**
(`apps/api/src/email/gmail-email.adapter.ts`), selectable via `EMAIL_ADAPTER=gmail` alongside the
original `resend`/`recording` adapters, all behind the same `EmailPort` interface the assessment's
email architecture already defined. This exists because Resend requires a verified sending
domain/address, which needs a domain you own; Gmail SMTP only needs a Google account and an App
Password. It changes nothing about how email is used elsewhere in the app (SEC-17's handling of
invitation/reset secrets — encrypted at rest, cleared on send, never logged — is identical
regardless of which adapter is active, since that all happens before the adapter is ever called)
and, like self-service registration above, was not part of the graded scope.

## Known limitations and risks

- See "Not yet delivered" above — everything else in the required functional scope is implemented
  and tested.
- Login throttling is keyed by account and by source address, sharing state across all callers
  from one address within the window; this is the correct SEC-16 behavior (prevents bypassing
  per-account throttling by rotating emails from one source) but means heavy legitimate traffic
  from behind a shared NAT/proxy would also be slowed. Not a concern at assessment scale.
- Session length (12h) and the login-throttle backoff curve are reasonable defaults, not values
  specified by the assessment; both are easy to retune without structural changes.

## Loom demonstration

**Not yet recorded.** Will show: Platform Administrator bootstrap login; Organization provisioning
with a real invitation email arriving in a candidate-controlled mailbox; opening the link,
activating the account, and demonstrating the same invitation cannot be reused; a real
password-reset email and successful completion; Company/Business Scope creation; collaborator
invitation, acceptance, suspension, and promotion; and an atomic ownership transfer. Link to be
added here before submission.
