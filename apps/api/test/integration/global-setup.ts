import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

// Loaded once for the whole integration run, before any test file imports
// AppModule (which reads process.env at import time via @nestjs/config).
dotenv.config({ path: path.join(__dirname, "../../../../.env.test"), override: true });

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
}
