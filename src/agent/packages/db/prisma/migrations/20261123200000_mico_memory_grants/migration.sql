-- Per-Mico access to personal memory servers (specs/mcp-memory, phase 2).
-- Additive: older API releases never read this table.
-- CreateTable
CREATE TABLE "mico_memory_grants" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'read',
    "autoRecall" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mico_memory_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mico_memory_grants_botId_connectionId_key" ON "mico_memory_grants"("botId", "connectionId");

-- CreateIndex
CREATE INDEX "mico_memory_grants_spaceId_userId_botId_idx" ON "mico_memory_grants"("spaceId", "userId", "botId");

-- AddForeignKey
ALTER TABLE "mico_memory_grants" ADD CONSTRAINT "mico_memory_grants_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mico_memory_grants" ADD CONSTRAINT "mico_memory_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mico_memory_grants" ADD CONSTRAINT "mico_memory_grants_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mico_memory_grants" ADD CONSTRAINT "mico_memory_grants_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "memory_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A grant belongs to the connection's owner in one Space; nobody else sees it.
ALTER TABLE "mico_memory_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mico_memory_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY mico_memory_grants_owner ON "mico_memory_grants" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '') AND
  EXISTS (SELECT 1 FROM space_members m WHERE m."spaceId" = "mico_memory_grants"."spaceId" AND m."userId" = "mico_memory_grants"."userId")
);
CREATE POLICY mico_memory_grants_system ON "mico_memory_grants" USING (current_setting('app.rls_bypass', true) = 'on');
