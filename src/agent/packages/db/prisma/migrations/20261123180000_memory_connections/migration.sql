-- Personal memory servers over the open Memory MCP profile (specs/mcp-memory).
-- Additive: older API releases never read this table.
-- CreateTable
CREATE TABLE "memory_connections" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "toolMapping" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'unchecked',
    "message" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memory_connections_serverId_key" ON "memory_connections"("serverId");

-- CreateIndex
CREATE INDEX "memory_connections_spaceId_userId_idx" ON "memory_connections"("spaceId", "userId");

-- AddForeignKey
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A connection belongs to one person in one Space; nobody else sees it.
ALTER TABLE "memory_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_connections_owner ON "memory_connections" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '') AND
  EXISTS (SELECT 1 FROM space_members m WHERE m."spaceId" = "memory_connections"."spaceId" AND m."userId" = "memory_connections"."userId")
);
CREATE POLICY memory_connections_system ON "memory_connections" USING (current_setting('app.rls_bypass', true) = 'on');
