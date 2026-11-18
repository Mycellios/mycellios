-- Per-user data for Hifa Store apps, reached only through the host bridge.
-- Rows belong to the visiting user/Space, not the app owner; deleting the app
-- deletes its data. Preview rows stay separate so a draft cannot corrupt them.
CREATE TABLE hosted_web_data (
  id TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL REFERENCES hosted_webs(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  preview BOOLEAN NOT NULL,
  key TEXT NOT NULL CHECK (key ~ '^[A-Za-z0-9_.:/-]{1,200}$'),
  value JSONB NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 1048576),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("siteId", "userId", "spaceId", preview, key)
);
CREATE INDEX "hosted_web_data_spaceId_userId_idx" ON hosted_web_data ("spaceId", "userId");
ALTER TABLE hosted_web_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_data FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_web_data_owner ON hosted_web_data USING (
  "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
  "userId"=NULLIF(current_setting('app.user_id',true),'') AND
  EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_data."spaceId" AND m."userId"=hosted_web_data."userId")
);
CREATE POLICY hosted_web_data_system ON hosted_web_data USING (current_setting('app.rls_bypass',true)='on');
