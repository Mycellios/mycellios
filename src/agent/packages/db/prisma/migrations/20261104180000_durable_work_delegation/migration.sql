-- Additive; existing tasks retain their original lifecycle. Rollback is code-only.
ALTER TABLE tasks
  ADD COLUMN "workPlan" JSONB,
  ADD COLUMN "parentTaskId" TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN "delegationRootId" TEXT,
  ADD COLUMN "delegationKey" TEXT,
  ADD COLUMN "delegationState" TEXT,
  ADD COLUMN "delegationRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delegatedRunId" TEXT,
  ADD COLUMN "expectedResult" TEXT,
  ADD COLUMN resources TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN dependencies TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "returnRunId" TEXT,
  ADD COLUMN "returnedToParentAt" TIMESTAMP(3),
  ADD COLUMN "delegationCheckedAt" TIMESTAMP(3),
  ADD COLUMN "workStopPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "workStopTargets" JSONB;
ALTER TABLE tasks ADD CONSTRAINT tasks_delegation_state_check CHECK
  ("delegationState" IS NULL OR "delegationState" IN ('queued','running','waiting','completed','failed','paused','cancelled'));
CREATE UNIQUE INDEX "tasks_delegationKey_key" ON tasks("delegationKey");
CREATE INDEX "tasks_spaceId_userId_delegationState_idx" ON tasks("spaceId", "userId", "delegationState");
CREATE INDEX "tasks_parentTaskId_idx" ON tasks("parentTaskId");
