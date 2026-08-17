# Convenience wrapper around the documented `pnpm` scripts (see README.md).
# Nothing here replaces those scripts or the commands a reviewer would run —
# this just removes recurring friction for local testing:
#   - sourcing .env before running anything that needs it. Neither
#     `bootstrap-roles.ts` nor `prisma migrate dev` load .env on their own
#     (no dotenv call, no packages/db/.env for Prisma to auto-discover) —
#     both read straight from the shell's process environment. Turborepo
#     (`pnpm dev`) is the same story: envMode: loose (turbo.json) passes
#     through whatever's already in the shell, it doesn't read .env itself.
#     So every target below that touches the database or starts the app
#     sources .env first. See Mybook.md §1 for the failure mode if this is
#     ever skipped (`Missing required env var POSTGRES_ROOT_URL`, etc).
#   - remembering the fresh-clone sequence (install -> db up -> migrate ->
#     seed -> bootstrap) as one command instead of five.
#
# .ONESHELL so `source .env` on one recipe line stays in effect for the
# rest of that same target's lines (Make normally runs each line in its own
# fresh subshell, which would silently drop the sourced variables).

SHELL := /bin/bash
# -e: stop a target's recipe at the first failing line — needed because
# .ONESHELL below disables Make's normal per-line failure detection (without
# this, a failed `pnpm db:migrate` would silently be followed by `db:seed`
# and `bootstrap-admin` running against a half-migrated database).
.SHELLFLAGS := -ec
.ONESHELL:
.PHONY: setup dev test test-unit test-integration test-e2e lint typecheck build down reset-db bootstrap-admin logs wait-for-db help

help:
	@echo ""
	@echo "⚠️  Before running any command, create and fill the .env file."
	@echo "   Most targets require environment variables such as"
	@echo "   POSTGRES_ROOT_URL and other database configuration values."
	@echo ""
	@echo "Available commands:"
	@echo ""
	@echo "  make setup            Install dependencies, start DB, run migrations,"
	@echo "                        seed data, and create the platform admin."
	@echo ""
	@echo "  make dev              Start the application in development mode."
	@echo ""
	@echo "  make test             Run the full test suite (lint, typecheck,"
	@echo "                        unit, integration, and e2e tests)."
	@echo ""
	@echo "  make test-unit        Run unit tests only."
	@echo "  make test-integration Run integration tests only."
	@echo "  make test-e2e         Run end-to-end tests only."
	@echo ""
	@echo "  make lint             Run ESLint."
	@echo "  make typecheck        Run TypeScript type checking."
	@echo "  make build            Build all applications."
	@echo ""
	@echo "  make down             Stop the PostgreSQL container."
	@echo ""
	@echo "  make reset-db         Completely reset the database volume,"
	@echo "                        recreate databases, run migrations,"
	@echo "                        and reseed data."
	@echo ""
	@echo "  make bootstrap-admin  Create the platform administrator if missing."
	@echo ""
	@echo "  make logs             Follow PostgreSQL container logs."
	@echo ""
	@echo "  make wait-for-db      Wait until PostgreSQL is healthy."
	@echo ""

## One command from a fresh clone: install deps, generate the Prisma client,
## build the internal @nova/shared and @nova/db packages, start Postgres,
## migrate, seed, bootstrap the platform admin.
setup:
	rm -rf apps/web/.turbo apps/api/.turbo packages/shared/.turbo packages/db/.turbo
	pnpm db:generate 2>&1 | tail -5
	pnpm build --force 2>&1 | tail -60
	pnpm install
	set -a && source .env && set +a
	pnpm db:generate
	pnpm build
	pnpm db:up
	$(MAKE) wait-for-db
	pnpm db:migrate
	pnpm db:seed
	pnpm bootstrap:platform-admin

# `docker compose up -d` returns as soon as the container starts, not once
# Postgres is actually accepting connections — immediately following it with
# a migration can lose this race, especially right after a fresh volume.
# Poll the container's own healthcheck instead of guessing a fixed sleep.
wait-for-db:
	for i in $$(seq 1 30); do \
		status=$$(docker inspect --format='{{.State.Health.Status}}' nova_postgres 2>/dev/null || echo starting); \
		if [ "$$status" = "healthy" ]; then exit 0; fi; \
		sleep 1; \
	done; \
	echo "Postgres did not become healthy within 30s" >&2; exit 1

## Start web (:3000) + api (:4000) with .env correctly loaded into the shell.
dev:
	set -a && source .env && set +a
	pnpm dev

## Full local validation harness, in the same order CI runs it. Stops at the first failure.
test: lint typecheck test-unit test-integration test-e2e

test-unit:
	pnpm test:unit

test-integration:
	pnpm test:integration

test-e2e:
	pnpm test:e2e

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

## Stop Postgres (data volume persists — use reset-db to wipe it).
down:
	pnpm db:down

## Wipe the ENTIRE Postgres data volume and rebuild both the dev (`nova`) and
## test (`nova_test`) databases from scratch. Destructive. The two databases
## share one Postgres instance/volume, so wiping one wipes both — this
## target restores both, leaving `pnpm dev` and `pnpm test:integration`/
## `test:e2e` all working afterward instead of only the dev DB.
reset-db:
	pnpm db:down
	docker volume rm nova-saas_nova_postgres_data 2>/dev/null || true
	set -a && source .env && set +a
	pnpm db:up
	$(MAKE) wait-for-db
	pnpm db:migrate
	pnpm db:seed
	pnpm db:test:setup

## Re-run the Platform Administrator bootstrap (no-ops if one already exists — see Mybook.md §2).
bootstrap-admin:
	set -a && source .env && set +a
	pnpm bootstrap:platform-admin

## Tail the Postgres container's logs.
logs:
	docker compose logs -f postgres
