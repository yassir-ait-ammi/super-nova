/**
 * One-time local convenience: creates the dedicated `nova_test` database
 * (used by `pnpm test:integration` and `pnpm test:e2e`, never by `pnpm dev`)
 * if it doesn't already exist, then bootstraps its roles and applies
 * migrations. Safe to re-run. Not used by CI, which provisions its own
 * Postgres service already named `nova_test` (see .github/workflows/ci.yml).
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.join(__dirname, "../../../.env") });

async function ensureDatabase() {
  const rootUrl = process.env.POSTGRES_ROOT_URL;
  if (!rootUrl) throw new Error("POSTGRES_ROOT_URL is required (from .env)");

  const client = new Client({ connectionString: rootUrl });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'nova_test'");
    if (exists.rows.length === 0) {
      await client.query("CREATE DATABASE nova_test");
      console.log("[setup-test-db] created nova_test");
    } else {
      console.log("[setup-test-db] nova_test already exists");
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await ensureDatabase();

  const testEnv = dotenv.parse(readFileSync(path.join(__dirname, "../../../.env.test")));
  const env = { ...process.env, ...testEnv };

  execFileSync("npx", ["tsx", "scripts/bootstrap-roles.ts"], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: "inherit",
  });
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error("[setup-test-db] failed:", error);
  process.exit(1);
});
