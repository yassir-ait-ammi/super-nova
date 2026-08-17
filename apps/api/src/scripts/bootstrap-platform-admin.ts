/**
 * Secure, one-time Platform Administrator bootstrap (architecture's
 * "Identity and authentication" responsibility: "secure Platform
 * Administrator bootstrap").
 *
 * - No-ops if a Platform Administrator already exists (idempotent, safe to
 *   re-run — e.g. in CI).
 * - Reads PLATFORM_ADMIN_BOOTSTRAP_EMAIL from the environment. If
 *   PLATFORM_ADMIN_BOOTSTRAP_PASSWORD is unset, generates a compliant
 *   high-entropy password and prints it exactly once — it is never stored
 *   in plaintext or logged again.
 * - Runs as the nova_app runtime role, proving the ordinary least-privilege
 *   grants are sufficient for this operation (no superuser shortcut).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../../../../.env") });

import { createAppPrismaClient, hashPassword } from "@nova/db";
import { normalizeEmail, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nova/shared";

function loadBlocklist(): Set<string> {
  const blocklistPath = path.join(__dirname, "../identity/data/weak-password-blocklist.txt");
  const contents = readFileSync(blocklistPath, "utf8");
  return new Set(
    contents
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)
  );
}

function generateCompliantPassword(): string {
  // 24 random bytes -> ~32 base64url chars, well within [15,64] and not a
  // dictionary word, so it can never collide with the blocklist.
  return randomBytes(24).toString("base64url");
}

async function main() {
  const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL;
  if (!email) {
    throw new Error("PLATFORM_ADMIN_BOOTSTRAP_EMAIL is required");
  }
  const appDatabaseUrl = process.env.APP_DATABASE_URL;
  if (!appDatabaseUrl) {
    throw new Error("APP_DATABASE_URL is required");
  }

  const prisma = createAppPrismaClient(appDatabaseUrl);

  try {
    const existing = await prisma.platformAdministrator.findFirst();
    if (existing) {
      console.log("[bootstrap-platform-admin] a Platform Administrator already exists — no-op");
      return;
    }

    let password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
    let generated = false;
    if (!password) {
      password = generateCompliantPassword();
      generated = true;
    } else {
      const length = [...password].length;
      if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
        throw new Error(`PLATFORM_ADMIN_BOOTSTRAP_PASSWORD must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
      }
      if (loadBlocklist().has(password.toLowerCase())) {
        throw new Error("PLATFORM_ADMIN_BOOTSTRAP_PASSWORD is on the weak-password blocklist");
      }
    }

    const argon2Hash = await hashPassword(password);
    const normalizedEmail = normalizeEmail(email);

    await prisma.$transaction(async (tx) => {
      const identity = await tx.identity.create({
        data: {
          normalizedEmail,
          displayEmail: email,
          passwordCredential: { create: { argon2Hash } },
        },
      });
      await tx.platformAdministrator.create({ data: { identityId: identity.id } });
    });

    console.log(`[bootstrap-platform-admin] Platform Administrator created: ${normalizedEmail}`);
    if (generated) {
      console.log(`[bootstrap-platform-admin] Generated password (shown once, save it now): ${password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[bootstrap-platform-admin] failed:", error);
  process.exit(1);
});
