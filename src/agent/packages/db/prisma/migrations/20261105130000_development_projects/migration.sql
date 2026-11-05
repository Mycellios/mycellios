-- Additive project metadata only. Repository paths and worktrees stay native-only.
CREATE TABLE "development_projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "development_projects_spaceId_userId_idx" ON "development_projects" ("spaceId", "userId");
ALTER TABLE "development_projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY development_projects_tenant ON "development_projects"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '') AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY development_projects_system ON "development_projects"
  USING (current_setting('app.rls_bypass', true) = 'on');
