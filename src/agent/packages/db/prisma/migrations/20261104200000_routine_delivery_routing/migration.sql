-- Additive operational receipts. No messages, user content or credentials are copied.
CREATE TABLE "routine_delivery_receipts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
  "source" TEXT NOT NULL,
  "keyDigest" TEXT NOT NULL,
  "routineIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "routine_delivery_receipts_scope_key" ON "routine_delivery_receipts" ("spaceId", "userId", "botId", "source", "keyDigest");
CREATE INDEX "routine_delivery_receipts_botId_createdAt_idx" ON "routine_delivery_receipts" ("botId", "createdAt");
ALTER TABLE "routine_delivery_receipts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_delivery_receipts_tenant ON "routine_delivery_receipts"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '') AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY routine_delivery_receipts_system ON "routine_delivery_receipts"
  USING (current_setting('app.rls_bypass', true) = 'on');
