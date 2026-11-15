ALTER TABLE task_inbox ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "remindAt" TIMESTAMP(3), ADD COLUMN "reminderNotifiedAt" TIMESTAMP(3),
 ADD COLUMN "reminderClaimedAt" TIMESTAMP(3);
CREATE INDEX task_inbox_reminder_due_idx ON task_inbox("remindAt")
 WHERE "archivedAt" IS NULL AND "remindAt" IS NOT NULL AND "reminderNotifiedAt" IS NULL;
