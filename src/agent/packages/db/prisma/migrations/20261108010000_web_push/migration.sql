-- Additive, account-owned records. Endpoints/keys and notification payloads are encrypted.
CREATE TABLE "web_push_settings" (
  "userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE "web_push_devices" (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "sessionId" text NOT NULL,
  "clientId" text NOT NULL,
  digest text NOT NULL UNIQUE,
  ciphertext text NOT NULL,
  "focusedUntil" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "sessionId", "clientId")
);
CREATE INDEX web_push_devices_user ON web_push_devices ("userId");
CREATE TABLE "web_push_presence" (
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "sessionId" text NOT NULL,
  "clientId" text NOT NULL,
  "focusedUntil" timestamptz NOT NULL,
  PRIMARY KEY ("userId", "sessionId", "clientId")
);
CREATE TABLE "web_push_deliveries" (
  id text PRIMARY KEY,
  "deviceId" text NOT NULL REFERENCES web_push_devices(id) ON DELETE CASCADE,
  "eventKey" text NOT NULL,
  ciphertext text NOT NULL,
  "spaceId" text NOT NULL,
  "botId" text NOT NULL,
  "runId" text NOT NULL,
  kind text NOT NULL,
  "eventId" text NOT NULL,
  "dueAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "leaseUntil" timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  "finishedAt" timestamptz,
  UNIQUE ("deviceId", "eventKey")
);
CREATE INDEX web_push_deliveries_due ON web_push_deliveries ("dueAt") WHERE "finishedAt" IS NULL;
ALTER TABLE web_push_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_push_presence_system ON web_push_presence USING (current_setting('app.rls_bypass', true) = 'on') WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY web_push_settings_system ON web_push_settings USING (current_setting('app.rls_bypass', true) = 'on') WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY web_push_devices_system ON web_push_devices USING (current_setting('app.rls_bypass', true) = 'on') WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
CREATE POLICY web_push_deliveries_system ON web_push_deliveries USING (current_setting('app.rls_bypass', true) = 'on') WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
