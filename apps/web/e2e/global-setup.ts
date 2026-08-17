import { execFileSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.join(__dirname, "../../../.env.test"), override: true });

const TENANT_TABLES = [
  "membership_scope_grants",
  "membership_capabilities",
  "invitations",
  "memberships",
  "business_scopes",
  "companies",
  "admin_evidence",
  "email_outbox",
  "organizations",
];
const GLOBAL_TABLES = [
  "sessions",
  "password_reset_tokens",
  "login_attempts",
  "password_credentials",
  "platform_administrators",
  "identities",
];

export default async function globalSetup() {
  const client = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
  await client.connect();
  try {
    const all = [...TENANT_TABLES, ...GLOBAL_TABLES].map((t) => `"${t}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${all} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }

  // Exercises the real, documented bootstrap command against the test
  // database so the E2E suite starts from the same state a reviewer's
  // `pnpm bootstrap:platform-admin` would produce.
  execFileSync("node", [path.join(__dirname, "../../api/dist/scripts/bootstrap-platform-admin.js")], {
    env: process.env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
}
