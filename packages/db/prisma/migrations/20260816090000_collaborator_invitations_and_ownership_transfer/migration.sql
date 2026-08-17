-- CreateEnum
CREATE TYPE "ownership_transfer_status" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "pending_grants" JSONB;

-- CreateTable
CREATE TABLE "ownership_transfer_proposals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "proposer_membership_id" UUID NOT NULL,
    "successor_membership_id" UUID NOT NULL,
    "status" "ownership_transfer_status" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ownership_transfer_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ownership_transfer_proposals_organization_id_idx" ON "ownership_transfer_proposals"("organization_id");

-- AddForeignKey
ALTER TABLE "ownership_transfer_proposals" ADD CONSTRAINT "ownership_transfer_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
