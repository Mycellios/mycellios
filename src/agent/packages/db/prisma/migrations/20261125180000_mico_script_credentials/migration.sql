BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "mico_script_settings" (
  "botId" TEXT PRIMARY KEY REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "requestsPerHour" INTEGER NOT NULL DEFAULT 60,
  CONSTRAINT "mico_script_settings_rate_check" CHECK ("requestsPerHour" IN (60, 120, 250, 500, 1000))
);
CREATE UNIQUE INDEX "mico_script_settings_botId_spaceId_userId_key"
  ON "mico_script_settings" ("botId", "spaceId", "userId");

CREATE TABLE "mico_script_tokens" (
  "id" TEXT PRIMARY KEY,
  "botId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "hint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "mico_script_tokens_botId_spaceId_userId_fkey"
    FOREIGN KEY ("botId", "spaceId", "userId") REFERENCES "mico_script_settings" ("botId", "spaceId", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mico_script_tokens_digest_key" ON "mico_script_tokens" ("digest");
CREATE INDEX "mico_script_tokens_botId_idx" ON "mico_script_tokens" ("botId");

ALTER TABLE "mico_script_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mico_script_settings_tenant ON "mico_script_settings" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY mico_script_settings_system ON "mico_script_settings"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "mico_script_tokens" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mico_script_tokens_tenant ON "mico_script_tokens" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY mico_script_tokens_system ON "mico_script_tokens"
  USING (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
