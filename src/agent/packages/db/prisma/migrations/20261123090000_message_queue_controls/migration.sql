-- Queue controls for messages that wait in a conversation (specs/mico-message-queue).
-- Additive: code without these columns ignores them. Rows that already wait keep their
-- order (their message number); every other row stays NULL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Nullable, no default: no table rewrite.
ALTER TABLE "steering_messages" ADD COLUMN "position" INTEGER,
  ADD COLUMN "heldBy" TEXT,
  ADD COLUMN "heldAt" TIMESTAMP(3),
  ADD COLUMN "editDraft" TEXT;

UPDATE "steering_messages" AS s
SET "position" = m."seq"
FROM "messages" AS m
WHERE m."id" = s."messageId"
  AND s."originTrigger" = 'queued_user'
  AND s."runId" IS NULL
  AND s."position" IS NULL;

COMMIT;
