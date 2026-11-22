-- Conversation lifecycle on the thread itself. Additive and nullable: code without it
-- ignores these columns. Rolling the code back keeps working because the Tasks inbox
-- archive mark (task_inbox."archivedAt") is still written as a mirror; never drop it here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "threads" ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "titleSource" TEXT,
  ADD COLUMN "startedBy" TEXT,
  ADD COLUMN "startedByRunId" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "deleteAfter" TIMESTAMP(3),
  ADD COLUMN "branchedFromThreadId" TEXT,
  ADD COLUMN "branchedFromMessageId" TEXT;

-- Archive moves from the Tasks inbox to the thread. Only Mico side threads carry it.
UPDATE "threads" t SET "archivedAt" = i."archivedAt"
FROM "task_inbox" i
WHERE i."threadId" = t.id AND i."archivedAt" IS NOT NULL AND t."taskBotId" IS NOT NULL;

-- Who opened each existing side thread, read from the same server-made keys as
-- taskThreadKind(): delegated work first, then routines and workflows, else the person.
UPDATE "threads" SET "startedBy" = CASE
    WHEN COALESCE("taskKey", '') LIKE 'delegation:%' OR COALESCE("taskKey", '') LIKE 'work-transfer:%' THEN 'delegation'
    WHEN COALESCE("taskKey", '') LIKE 'routine:%' OR COALESCE("projectKey", '') LIKE 'routine:%'
      OR COALESCE("taskKey", '') LIKE 'workflow:%' OR COALESCE("projectKey", '') LIKE 'workflow:%' THEN 'routine'
    ELSE 'user'
  END
WHERE "taskBotId" IS NOT NULL;

-- Server-named threads keep automatic titles. Existing conversation titles may have been
-- typed by the person, so their source stays unknown (NULL) and nothing renames them.
UPDATE "threads" SET "titleSource" = 'auto'
WHERE "taskBotId" IS NOT NULL AND "title" IS NOT NULL AND "startedBy" IN ('routine', 'delegation');

-- The outcome and error of the last finished turn, from the newest finished run that is
-- not background work.
UPDATE "threads" t SET
  "outcome" = CASE latest.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'interrupted' END,
  "lastError" = CASE WHEN latest.status = 'failed' THEN left(NULLIF(btrim(latest.error), ''), 2000) END
FROM "threads" s
CROSS JOIN LATERAL (
  SELECT r.status, r.error FROM "runs" r
  WHERE r."threadId" = s.id AND r.status IN ('completed', 'failed', 'cancelled')
    AND r."trigger" NOT IN ('tickets', 'project_prepare')
  ORDER BY r."createdAt" DESC, r.id DESC
  LIMIT 1
) latest
WHERE t.id = s.id AND s."taskBotId" IS NOT NULL;

ALTER TABLE "threads" ADD CONSTRAINT "threads_title_source_chk"
  CHECK ("titleSource" IS NULL OR "titleSource" IN ('auto', 'agent', 'user')) NOT VALID;
ALTER TABLE "threads" ADD CONSTRAINT "threads_started_by_chk"
  CHECK ("startedBy" IS NULL OR "startedBy" IN ('user', 'agent', 'routine', 'branch', 'delegation')) NOT VALID;
ALTER TABLE "threads" ADD CONSTRAINT "threads_outcome_chk"
  CHECK ("outcome" IS NULL OR "outcome" IN ('completed', 'failed', 'interrupted')) NOT VALID;
ALTER TABLE "threads" ADD CONSTRAINT "threads_last_error_length_chk"
  CHECK ("lastError" IS NULL OR char_length("lastError") <= 2000) NOT VALID;
-- The main chat, groups and external conversations are never archived or deleted.
ALTER TABLE "threads" ADD CONSTRAINT "threads_lifecycle_side_thread_chk"
  CHECK (("archivedAt" IS NULL AND "deleteAfter" IS NULL) OR "taskBotId" IS NOT NULL) NOT VALID;
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_title_source_chk";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_started_by_chk";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_outcome_chk";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_last_error_length_chk";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_lifecycle_side_thread_chk";

-- Branch columns are reserved for branching; their sources may later disappear.
ALTER TABLE "threads" ADD CONSTRAINT "threads_startedByRunId_fkey" FOREIGN KEY ("startedByRunId")
  REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT "threads_branchedFromThreadId_fkey" FOREIGN KEY ("branchedFromThreadId")
  REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT "threads_branchedFromMessageId_fkey" FOREIGN KEY ("branchedFromMessageId")
  REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "threads_taskBotId_archivedAt_idx" ON "threads"("taskBotId", "archivedAt");
CREATE INDEX "threads_deleteAfter_idx" ON "threads"("deleteAfter");
-- The SET NULL references above need these so deleting runs or messages never scans threads.
CREATE INDEX "threads_startedByRunId_idx" ON "threads"("startedByRunId");
CREATE INDEX "threads_branchedFromThreadId_idx" ON "threads"("branchedFromThreadId");
CREATE INDEX "threads_branchedFromMessageId_idx" ON "threads"("branchedFromMessageId");
COMMIT;
