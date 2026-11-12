-- Preserve the legacy table and encrypted data for rolling upgrades and rollback.
CREATE TABLE "mobile_push_devices" (
  "tokenDigest" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "ciphertext" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "mobile_push_devices_userId_sessionId_idx" ON "mobile_push_devices"("userId", "sessionId");
ALTER TABLE "mobile_push_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mobile_push_devices_system ON "mobile_push_devices"
  USING (current_setting('app.rls_bypass', true) = 'on');
