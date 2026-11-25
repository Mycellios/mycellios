-- Space members, phase 1b (specs/space-members/spec.md): Micos shared with people in a Space other
-- than Personal, and each person's own conversations with them. Additive: the previous release
-- never reads the new tables, every new column is nullable without a default, and nothing that
-- release writes changes meaning.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- A member's conversation stays the Mico owner's thread; these name the person behind it. No
-- foreign keys: their conversations and messages keep their author after they leave.
ALTER TABLE "threads" ADD COLUMN     "memberUserId" TEXT;
ALTER TABLE "messages" ADD COLUMN     "authorUserId" TEXT;
ALTER TABLE "runs" ADD COLUMN     "requestedByUserId" TEXT;
ALTER TABLE "artifacts" ADD COLUMN     "memberUserId" TEXT;
-- The owner pays for a member's turns; the receipts and holds say whose turns they were.
ALTER TABLE "usage_records" ADD COLUMN     "requestedByUserId" TEXT;
ALTER TABLE "model_credit_entries" ADD COLUMN     "requestedByUserId" TEXT;

-- Who a Mico is shared with: everyone in its Space, or the people in mico_share_members. No row
-- is the default, `none`.
CREATE TABLE "mico_shares" (
    "botId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "everyone" BOOLEAN NOT NULL DEFAULT false,
    "dailyAllowanceMicros" BIGINT NOT NULL DEFAULT 1000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mico_shares_pkey" PRIMARY KEY ("botId"),
    -- 0 stops the person's messages; at most 100 Credits per UTC day.
    CONSTRAINT "mico_shares_dailyAllowanceMicros_check" CHECK (
      "dailyAllowanceMicros" >= 0 AND "dailyAllowanceMicros" <= 100000000
    )
);

CREATE TABLE "mico_share_members" (
    "botId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mico_share_members_pkey" PRIMARY KEY ("botId","userId")
);

-- CreateIndex
CREATE INDEX "mico_shares_spaceId_idx" ON "mico_shares"("spaceId");

-- CreateIndex
CREATE INDEX "mico_share_members_spaceId_userId_idx" ON "mico_share_members"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "threads_spaceId_memberUserId_idx" ON "threads"("spaceId", "memberUserId");

-- CreateIndex
CREATE INDEX "model_credit_entries_requestedByUserId_createdAt_idx" ON "model_credit_entries"("requestedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "mico_shares" ADD CONSTRAINT "mico_shares_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mico_shares" ADD CONSTRAINT "mico_shares_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mico_share_members" ADD CONSTRAINT "mico_share_members_botId_fkey" FOREIGN KEY ("botId") REFERENCES "mico_shares"("botId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Removal and leaving delete the Space membership, and with it the person's shares.
ALTER TABLE "mico_share_members" ADD CONSTRAINT "mico_share_members_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Shares stop at the Space like the Micos they name: the API resolves who may use one on every
-- request, and the worker checks again before each paid model call.
ALTER TABLE "mico_shares" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mico_shares_tenant ON "mico_shares"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY mico_shares_system ON "mico_shares"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mico_share_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mico_share_members_tenant ON "mico_share_members"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY mico_share_members_system ON "mico_share_members"
  USING (current_setting('app.rls_bypass', true) = 'on');

-- A hold's requester decides whose daily allowance it counts against, so it is as immutable as
-- the rest of its attribution. The previous release never writes the column.
CREATE OR REPLACE FUNCTION billing_credit_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."callId" IS DISTINCT FROM OLD."callId"
 OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
 OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.model IS DISTINCT FROM OLD.model OR NEW.source IS DISTINCT FROM OLD.source
 OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
 OR (OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId")
 THEN RAISE EXCEPTION 'Credit attribution is immutable'; END IF;
 RETURN NEW;
END $$;

COMMIT;
