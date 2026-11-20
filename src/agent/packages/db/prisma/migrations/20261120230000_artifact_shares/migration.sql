-- One owner-created share link per artifact family, pinned to the exact version the owner
-- shared (specs/artifact-share-links). Additive: older API releases never read it.
CREATE TABLE artifact_shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  "rootArtifactId" TEXT NOT NULL UNIQUE REFERENCES artifacts(id) ON DELETE CASCADE,
  "artifactId" TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "artifact_shares_spaceId_userId_idx" ON artifact_shares ("spaceId", "userId");
CREATE INDEX "artifact_shares_artifactId_idx" ON artifact_shares ("artifactId");
ALTER TABLE artifact_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_shares_owner ON artifact_shares USING (
  "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
  "userId"=NULLIF(current_setting('app.user_id',true),'') AND
  EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=artifact_shares."spaceId" AND m."userId"=artifact_shares."userId")
);
CREATE POLICY artifact_shares_system ON artifact_shares USING (current_setting('app.rls_bypass',true)='on');
