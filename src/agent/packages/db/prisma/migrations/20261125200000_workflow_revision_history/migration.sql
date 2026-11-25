BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE workflow_versions (
  "workflowId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  graph JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workflowId", version),
  FOREIGN KEY ("workflowId", "spaceId", "userId")
    REFERENCES workflows(id, "spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX workflow_versions_owner_idx ON workflow_versions ("spaceId", "userId", "workflowId");
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_versions_tenant ON workflow_versions USING (
  ("spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
   "userId" = NULLIF(current_setting('app.user_id', true), '')) OR
  current_setting('app.rls_bypass', true) = 'on'
);
COMMIT;
