-- Signed webhook routines (specs/mico-automation/spec.md, phase 2): each webhook routine gets its
-- own Standard Webhooks secret, an optional event type and filters, and 7-day receipts of the
-- delivery ids it accepted (a digest, never the body). Additive only: the new columns are nullable
-- without a default, so no table is rewritten; the previous release never reads them or the new
-- tables, and deleting a routine cascades its rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "routines" ADD COLUMN "webhookEventType" TEXT,
ADD COLUMN "webhookFilters" JSONB;

CREATE TABLE "routine_webhook_secrets" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "routine_webhook_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "routine_event_receipts" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "runId" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_event_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routine_event_receipts_result_check" CHECK ("result" IN ('queued', 'ignored', 'paused'))
);

-- CreateIndex
CREATE INDEX "routine_webhook_secrets_routineId_idx" ON "routine_webhook_secrets"("routineId");

-- CreateIndex
CREATE UNIQUE INDEX "routine_event_receipts_routineId_keyDigest_key" ON "routine_event_receipts"("routineId", "keyDigest");

-- CreateIndex
CREATE INDEX "routine_event_receipts_routineId_createdAt_idx" ON "routine_event_receipts"("routineId", "createdAt");

-- CreateIndex
CREATE INDEX "routine_event_receipts_createdAt_idx" ON "routine_event_receipts"("createdAt");

-- AddForeignKey
ALTER TABLE "routine_webhook_secrets" ADD CONSTRAINT "routine_webhook_secrets_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_event_receipts" ADD CONSTRAINT "routine_event_receipts_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "routine_webhook_secrets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_webhook_secrets_tenant ON "routine_webhook_secrets" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY routine_webhook_secrets_system ON "routine_webhook_secrets"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "routine_event_receipts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_event_receipts_tenant ON "routine_event_receipts" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY routine_event_receipts_system ON "routine_event_receipts"
  USING (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
