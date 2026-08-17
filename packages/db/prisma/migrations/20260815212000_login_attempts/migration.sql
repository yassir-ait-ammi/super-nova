-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_attempts_normalized_email_created_at_idx" ON "login_attempts"("normalized_email", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_address_created_at_idx" ON "login_attempts"("ip_address", "created_at");

-- login_attempts is not tenant-owned (pre-authentication throttling data,
-- keyed by normalized email + source address) so it intentionally carries
-- no organization_id / RLS policy, consistent with identities/sessions.
