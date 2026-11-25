BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE workflow_webhooks (
  "workflowId" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  version INTEGER NOT NULL,
  "secretId" TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workflow_webhooks_identity_scope_key UNIQUE ("workflowId", "spaceId", "userId"),
  FOREIGN KEY ("workflowId", "spaceId", "userId")
    REFERENCES workflows(id, "spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX workflow_webhooks_owner_idx ON workflow_webhooks ("spaceId", "userId", "workflowId");
ALTER TABLE workflow_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_webhooks_tenant ON workflow_webhooks USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY workflow_webhooks_exact_lookup ON workflow_webhooks FOR SELECT
  USING (current_setting('app.rls_bypass', true) = 'on');
COMMIT;
