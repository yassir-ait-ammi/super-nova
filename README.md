# NOVA — SaaS Foundation & Collaborative Administration

A runnable, persistent, multi-Organization web application implementing both required NOVA
technical assessment modules: **SaaS Foundation & Platform Administration** (first-party
authentication, secure Platform Administrator bootstrap, Organization provisioning with real
transactional-email invitations (Resend or Gmail SMTP), lifecycle management, Postgres row-level
tenant isolation) and
**Client-side Collaborative Administration** (Companies/Business Scopes, collaborator invitations
with explicit permission grants, suspension/reactivation/removal, Administrator promotion, and
atomic ownership transfer).

See [`assessment-docs/`](assessment-docs/) for the assessment brief this implements, and
[`SUBMISSION.md`](SUBMISSION.md) for delivered scope, known limitations, and architecture notes.

## Stack

Strict TypeScript throughout · Next.js (web) · NestJS (API) · PostgreSQL + Prisma + hand-reviewed
SQL migrations for forced row-level security · Resend or Gmail SMTP (transactional email) ·
Vitest (unit + integration) · Playwright (E2E) · pnpm workspaces + Turborepo.

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm` if you don't have it)
- Docker (for local Postgres)

## Setup (clean clone)

```bash
pnpm install
cp .env.example .env          # fill in real email-adapter values later; placeholders work for local dev
pnpm db:generate               # generates the Prisma client — pnpm install alone does not do this
pnpm build                     # builds @nova/shared and @nova/db — apps/api imports their compiled
                                # dist/ by package name, not by source, so this must run before
                                # anything that imports them (bootstrap:platform-admin, dev, ...)
pnpm db:up                    # starts Postgres via docker compose
pnpm db:migrate                # creates nova_migrator/nova_app roles, applies all migrations
pnpm db:seed                   # deterministic synthetic data for 2 Organizations
pnpm bootstrap:platform-admin  # one-time Platform Administrator bootstrap (see below)
pnpm dev                       # web on :3000, API on :4000
```

Open http://localhost:3000.

A `Makefile` wraps the same commands (`make setup`, `make dev`, `make test`, ...) for local
convenience — the `pnpm` scripts below remain the authoritative documented commands. Run
`make help` to see every target with a description.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm db:generate` | Generate the Prisma client — required once after `install` before anything that touches the database (`db:seed`, `bootstrap:platform-admin`, `dev`, `build`) will run; `pnpm install` does not do this on its own |
| `pnpm db:up` / `pnpm db:down` | Start/stop the local Postgres container |
| `pnpm db:migrate` | Bootstrap DB roles + apply existing migrations, non-interactively (`prisma migrate deploy`) — use this for a fresh clone |
| `pnpm db:migrate:deploy` | Identical to `db:migrate`; kept as an explicit alias matching what CI runs |
| `pnpm db:migrate:dev` | `prisma migrate dev` — only for authoring a **new** migration during development; interactive, and will prompt for a migration name |
| `pnpm db:seed` | Seed deterministic synthetic data for ≥2 Organizations |
| `pnpm bootstrap:platform-admin` | One-time secure Platform Administrator bootstrap |
| `pnpm dev` | Run web + API in watch mode |
| `pnpm lint` | ESLint across every package (`--max-warnings=0`) |
| `pnpm typecheck` | Strict `tsc --noEmit` across every package |
| `pnpm test:unit` | Vitest unit tests (no database) |
| `pnpm test:integration` | Vitest integration tests against real PostgreSQL, including forced-RLS negative tests |
| `pnpm test:e2e` | Playwright end-to-end tests (builds, then drives the real app in a browser) |
| `pnpm build` | Production build of every package |

**Why `db:migrate` uses `prisma migrate deploy`, not `prisma migrate dev`:** several migrations in
this project are hand-reviewed raw SQL (RLS policies, composite tenant-safe foreign keys — see
[`packages/db/prisma/migrations/`](packages/db/prisma/migrations/)) rather than generated from
`schema.prisma`. Because of that, `schema.prisma`'s own datamodel never fully describes what's
actually in the database, so `prisma migrate dev`'s automatic drift-diffing always finds a
"difference" and interactively prompts for a new migration name — even right after applying every
existing migration cleanly, with nothing actually wrong. `migrate deploy` just applies whatever
migration files exist, in order, with no diffing — deterministic and safe for a fresh clone or CI.
Use `db:migrate:dev` only when you're deliberately authoring a new migration and are prepared to
review whatever Prisma proposes against the hand-written SQL already in place.

`pnpm test:integration` and `pnpm test:e2e` use a **separate `nova_test` database** and the
committed [`.env.test`](.env.test) (synthetic-only values, safe to commit — see its header
comment), so the real dev database is never touched by test runs. Create it once locally (after
`pnpm db:up`):

```bash
pnpm db:test:setup
```

(CI provisions its own `nova_test` Postgres service instead — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).)

## Real transactional email

The three required templates — initial-owner invitation, collaborator invitation, password reset
— go through one of three interchangeable adapters behind a single `EmailPort`
(`apps/api/src/email/email-port.ts`), selected by `EMAIL_ADAPTER` in `.env`. Pick whichever fits:

| `EMAIL_ADAPTER` | Adapter | Needs |
| --- | --- | --- |
| `recording` (default) | `RecordingEmailAdapter` | Nothing — captured in-process, never sent. Always used in tests regardless of this setting. |
| `resend` | `ResendEmailAdapter` | A [Resend](https://resend.com/) account with a **verified sending domain or address**. |
| `gmail` | `GmailEmailAdapter` | A Google account. No domain required. |

**Resend** — for a custom "from" domain:
1. Create a free [Resend](https://resend.com/) account and verify a sender domain/address.
2. In `.env`: `EMAIL_ADAPTER=resend`, `RESEND_API_KEY=<your key>`, `RESEND_SENDER_EMAIL=<verified sender>`.

**Gmail SMTP** — no domain needed, real email straight from a personal/workspace Gmail account
(`apps/api/src/email/gmail-email.adapter.ts`):
1. Enable **2-Step Verification** on the Google account you want to send from.
2. Create an **App Password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   (choose "Mail" / "Other" as the app) — Gmail no longer accepts a normal account password for
   SMTP.
3. In `.env`:
   ```
   EMAIL_ADAPTER=gmail
   GMAIL_USER=<your-account@gmail.com>
   GMAIL_APP_PASSWORD=<the 16-character app password>
   GMAIL_SENDER_NAME=NOVA
   ```
4. Restart the API. Note Gmail always sends *from* the authenticated account (or a verified
   alias) — unlike Resend, an arbitrary From address isn't possible; only the display name
   (`GMAIL_SENDER_NAME`) is configurable.

Automated tests (`test:unit`, `test:integration`, `test:e2e`) always use
`EMAIL_ADAPTER=recording` (the deterministic `RecordingEmailAdapter`) via `.env.test` and never
send external email, regardless of what `.env` is set to.

Whichever adapter is active, its credentials (`RESEND_API_KEY` / `GMAIL_APP_PASSWORD`, etc.) never
enter the repository, logs, evidence, or error responses — see `SUBMISSION.md` for how
invitation/reset secrets are handled end-to-end (SEC-17).

## Authentication, sessions, and password recovery

- **Self-service registration.** `/register` lets anyone create a brand-new Organization and
  become its owner immediately — no Platform Administrator provisioning step, no invitation. This
  is an addition made after the graded assessment scope (which was deliberately invite-only end to
  end); see "Beyond the assessment" in `SUBMISSION.md` for why and how it fits alongside the
  original invitation-based provisioning path, which still exists unchanged.
- **First-party email/password auth.** Passwords are hashed with Argon2id
  (`m=19456 KiB, t=2, p=1`, unique salt per hash — see `packages/db/src/password.ts`), never
  stored plaintext or reversibly encrypted. Policy: 15–64 Unicode characters, no character-class
  composition rule, checked against a vendored weak-password blocklist
  (`apps/api/src/identity/data/weak-password-blocklist.txt`).
- **Sessions.** Opaque, 256-bit, server-generated tokens; only their SHA-256 hash is stored.
  Carried in a `__Host-nova_session` cookie (`Secure; HttpOnly; SameSite=Strict; Path=/`) — never
  in `localStorage`/`sessionStorage`. A synchronizer-token CSRF header
  (`x-nova-csrf`) is required on every unsafe request from an authenticated session. Sessions are
  revoked server-side on logout, password reset, and Organization suspension/disablement; a
  completed password reset revokes every session for that identity.
- **Login throttling.** Bounded progressive delay keyed by both normalized email and source
  address (`apps/api/src/identity/throttle.service.ts`), backed by a durable `login_attempts`
  table (not in-memory) so it survives process restarts.
- **Secure Platform Administrator bootstrap.** `pnpm bootstrap:platform-admin` is a no-op once any
  Platform Administrator exists; otherwise it creates one from
  `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`PLATFORM_ADMIN_BOOTSTRAP_PASSWORD`, generating and printing a
  compliant one-time password if none is supplied.
- **Password recovery.** Neutral request/complete flow; single-use, hashed, 30-minute token;
  identical response whether or not the email exists.

## Tenant isolation

`Organization` is the only tenant boundary. Every tenant-owned table carries a non-null
`organization_id`, forced row-level security (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`), and a
composite Organization-aware foreign key on its parent relation. The runtime database role
(`nova_app`) owns no tables and cannot bypass RLS — see
`packages/db/prisma/migrations/20260815210000_rls_and_hardening/migration.sql` and
`apps/api/test/integration/rls-isolation.test.ts` for the executable proof (two Organizations,
missing context, malformed context, a reused pooled connection alternating tenants, and a forged
`organization_id` on insert).

## Local email inspection during development

With `EMAIL_ADAPTER=recording` (the default), sent emails are captured in-process, not delivered.
In `NODE_ENV=test` only, a test-only inspection endpoint
(`GET /api/test-support/emails/latest?to=<email>`) exposes the captured content — this is how the
Playwright suite recovers invitation/reset links without a real mailbox. This module is only ever
registered when `NODE_ENV=test` (see `apps/api/src/app.module.ts`) and is absent from any
dev/production run.

## Project layout

```
apps/
  api/    NestJS API — identity/auth, platform administration, organization administration,
          access control (memberships/invitations/permissions/ownership), email, evidence
  web/    Next.js web app — platform admin console + Organization admin area (/org/*)
packages/
  db/     Prisma schema, hand-reviewed RLS/constraint migrations, seed
  shared/ Shared zod schemas, capability/preset catalog, constants, and types used by both apps
```

## Client-side collaborative administration

Once logged in as an Organization member, `/org/companies` manages Companies and Business Scopes
(guided, duplicate-aware creation; a Company with active Business Scopes cannot be deactivated by
cascade) and `/org/members` manages collaborators: invite with an editable permission preset,
suspend/reactivate/remove, promote a `User` to `Administrator` (owner-only), and propose/accept an
atomic ownership transfer. Every sensitive action requires a reason and is recorded as evidence.
`User` profiles see only the Companies/Business Scopes they were explicitly granted;
`Administrator` profiles have full Organization access by profile.
