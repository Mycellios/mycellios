CREATE TABLE "tailnet_policies" (
  "id" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "dnsSuffix" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  UNIQUE ("spaceId", "dnsSuffix")
);
CREATE TABLE "tailnet_connections" (
  "id" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('personal', 'company')),
  "dnsSuffix" TEXT NOT NULL,
  "allowedBotIds" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (jsonb_typeof("allowedBotIds") = 'array')
);
CREATE INDEX "tailnet_connections_spaceId_userId_idx" ON "tailnet_connections"("spaceId", "userId");
ALTER TABLE "mcp_servers" ADD COLUMN "networkOAuthOrigins" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "mcp_servers" ADD COLUMN "networkId" TEXT REFERENCES "tailnet_connections"("id") ON DELETE RESTRICT;
ALTER TABLE "tailnet_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tailnet_policies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tailnet_connection_tenant ON "tailnet_connections"
  USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''))
  WITH CHECK ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY tailnet_connection_system ON "tailnet_connections" USING (current_setting('app.rls_bypass',true)='on');
CREATE POLICY tailnet_policy_tenant ON "tailnet_policies"
  USING ("spaceId"=NULLIF(current_setting('app.space_id',true),''))
  WITH CHECK ("spaceId"=NULLIF(current_setting('app.space_id',true),''));
CREATE POLICY tailnet_policy_system ON "tailnet_policies" USING (current_setting('app.rls_bypass',true)='on');
