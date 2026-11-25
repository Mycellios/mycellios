BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "mico_script_deliveries" (
  "id" TEXT PRIMARY KEY,
  "botId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('message', 'routine')),
  "keyDigest" TEXT,
  "requestDigest" TEXT NOT NULL,
  "routineId" TEXT,
  "threadId" TEXT NOT NULL,
  "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mico_script_deliveries_botId_spaceId_userId_fkey"
    FOREIGN KEY ("botId", "spaceId", "userId") REFERENCES "mico_script_settings" ("botId", "spaceId", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mico_script_deliveries_botId_keyDigest_key"
  ON "mico_script_deliveries" ("botId", "keyDigest");
CREATE INDEX "mico_script_deliveries_botId_createdAt_idx"
  ON "mico_script_deliveries" ("botId", "createdAt");
CREATE INDEX "mico_script_deliveries_tokenId_createdAt_idx"
  ON "mico_script_deliveries" ("tokenId", "createdAt");
CREATE INDEX "mico_script_deliveries_createdAt_idx" ON "mico_script_deliveries" ("createdAt");

ALTER TABLE "mico_script_deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mico_script_deliveries_tenant ON "mico_script_deliveries" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY mico_script_deliveries_system ON "mico_script_deliveries"
  USING (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
