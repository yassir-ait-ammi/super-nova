/**
 * One-time, idempotent bootstrap of the two Postgres roles NOVA runs under.
 *
 * - nova_migrator: owns the schema, runs Prisma migrations and the seed
 *   script. Has BYPASSRLS + CREATEDB (needed for Prisma's shadow database)
 *   because it is a migration/CI/dev tool credential, never used by the
 *   running API.
 * - nova_app: the runtime role the NestJS API connects as. NOSUPERUSER,
 *   NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, owns nothing — every statement it
 *   issues is subject to forced row-level security (SEC-03).
 *
 * Runs against POSTGRES_ROOT_URL (the Postgres container's superuser).
 * Safe to run repeatedly: every statement is guarded with an existence
 * check.
 */
import { Client } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function passwordFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.password) {
    throw new Error(`Connection URL for ${url.username} has no password`);
  }
  return url.password;
}

async function main() {
  const rootUrl = requireEnv("POSTGRES_ROOT_URL");
  const migratorUrl = requireEnv("MIGRATOR_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");

  const migratorPassword = passwordFromUrl(migratorUrl);
  const appPassword = passwordFromUrl(appUrl);

  const client = new Client({ connectionString: rootUrl });
  await client.connect();

  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nova_migrator') THEN
          CREATE ROLE nova_migrator LOGIN PASSWORD '${migratorPassword}' CREATEDB BYPASSRLS;
        ELSE
          ALTER ROLE nova_migrator WITH LOGIN PASSWORD '${migratorPassword}' CREATEDB BYPASSRLS;
        END IF;
      END
      $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nova_app') THEN
          CREATE ROLE nova_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
          ALTER ROLE nova_app WITH LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    const dbNameResult = await client.query<{ current_database: string }>(
      "SELECT current_database()"
    );
    const dbName = dbNameResult.rows[0]?.current_database;
    if (!dbName) {
      throw new Error("Could not determine current_database()");
    }

    await client.query(`ALTER DATABASE "${dbName}" OWNER TO nova_migrator`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO nova_migrator`);
    await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO nova_app`);

    console.log("[bootstrap-roles] nova_migrator and nova_app roles ready");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[bootstrap-roles] failed:", error);
  process.exit(1);
});
