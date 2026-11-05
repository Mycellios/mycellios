BEGIN;
CREATE TABLE "workflows" (
 "id" TEXT PRIMARY KEY, "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "graph" JSONB NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT false, "nextRunAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "workflows_owner_idx" ON "workflows"("spaceId", "userId");
CREATE UNIQUE INDEX "workflows_identity_scope_key" ON "workflows"("id", "spaceId", "userId");
CREATE INDEX "workflows_due_idx" ON "workflows"("nextRunAt") WHERE "active" AND "archivedAt" IS NULL;
CREATE TABLE "workflow_executions" (
 "id" TEXT PRIMARY KEY, "workflowId" TEXT NOT NULL,
 "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "version" INTEGER NOT NULL, "graph" JSONB NOT NULL, "triggerId" TEXT NOT NULL,
 "clientNonce" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "steps" JSONB NOT NULL DEFAULT '{}', "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("spaceId", "userId", "clientNonce"),
 FOREIGN KEY ("workflowId", "spaceId", "userId") REFERENCES "workflows"("id", "spaceId", "userId") ON DELETE CASCADE
);
CREATE INDEX "workflow_executions_owner_idx" ON "workflow_executions"("spaceId", "userId", "workflowId", "createdAt");
CREATE INDEX "workflow_executions_live_idx" ON "workflow_executions"("status") WHERE "status" IN ('queued','running');
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflows_tenant ON "workflows" USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '') AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY workflows_system ON "workflows" USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "workflow_executions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_executions_tenant ON "workflow_executions" USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '') AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY workflow_executions_system ON "workflow_executions" USING (current_setting('app.rls_bypass', true) = 'on');
COMMIT;
