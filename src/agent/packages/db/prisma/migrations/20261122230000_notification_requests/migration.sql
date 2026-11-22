-- Close an answered question or takeover notice on the person's other devices.
-- Additive: a nullable column and a new system-only table. Code without them keeps
-- delivering notices; it only stops closing them elsewhere.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- When the push service accepted this notice; NULL for held, dropped or pending rows.
ALTER TABLE web_push_deliveries ADD COLUMN "sentAt" timestamptz;

-- One row per question or takeover notice that reached a channel. A sweep marks it
-- resolved once its run no longer waits on that request and asks devices to close it.
CREATE TABLE notification_requests (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "spaceId" text NOT NULL,
  "botId" text NOT NULL,
  "threadId" text NOT NULL,
  "runId" text NOT NULL,
  "eventId" text NOT NULL,
  kind text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  UNIQUE ("runId", "eventId")
);
CREATE INDEX notification_requests_open ON notification_requests ("createdAt") WHERE "resolvedAt" IS NULL;
ALTER TABLE notification_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_requests_system ON notification_requests USING (current_setting('app.rls_bypass', true) = 'on') WITH CHECK (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
