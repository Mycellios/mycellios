CREATE TABLE "desktop_execution_preferences" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("spaceId", "userId"),
  FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "desktop_execution_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_execution_tenant ON "desktop_execution_preferences" USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY desktop_execution_system ON "desktop_execution_preferences" USING (current_setting('app.rls_bypass',true)='on');
