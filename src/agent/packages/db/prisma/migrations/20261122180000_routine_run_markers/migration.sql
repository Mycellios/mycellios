-- Routine runs in their own conversation (specs/mico-routine-runs). Additive: code without
-- these columns ignores them, and every default describes existing rows as they were (not
-- quiet, nothing missed, not paused by a run). Nothing is backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Constant defaults: no table rewrite.
ALTER TABLE "runs" ADD COLUMN "quiet" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "missedRuns" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "missedReason" TEXT;

-- New rows are checked at once; existing rows are all NULL, so NOT VALID skips a full scan
-- under the exclusive lock.
ALTER TABLE "runs" ADD CONSTRAINT "runs_missed_reason_check"
  CHECK ("missedReason" IS NULL OR "missedReason" IN ('offline', 'busy')) NOT VALID;

ALTER TABLE "routines" ADD COLUMN "pausedByRunId" TEXT,
  ADD COLUMN "pausedByRunAt" TIMESTAMP(3);

COMMIT;
