-- Private draft history for Hifa Store apps: one snapshot per saved draft version
-- (owner edit, Mico edit or restore). Bundles are Space-encrypted; the service
-- keeps the newest 50 snapshots within 64 MiB per app.
CREATE TABLE hosted_web_snapshots (
  id TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'mico', 'restore')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  summary TEXT NOT NULL CHECK (length(summary) <= 240),
  bundle JSONB NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 4194304),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("siteId", version),
  FOREIGN KEY ("siteId", "userId", "spaceId") REFERENCES hosted_webs(id, "userId", "spaceId") ON DELETE CASCADE
);
CREATE INDEX "hosted_web_snapshots_siteId_createdAt_idx" ON hosted_web_snapshots ("siteId", "createdAt");
CREATE FUNCTION hosted_web_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Draft snapshots are immutable'; END $$;
CREATE TRIGGER hosted_web_snapshot_immutable BEFORE UPDATE ON hosted_web_snapshots
 FOR EACH ROW EXECUTE FUNCTION hosted_web_snapshot_immutable();
ALTER TABLE hosted_web_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_web_snapshots_owner ON hosted_web_snapshots USING (
  "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
  "userId"=NULLIF(current_setting('app.user_id',true),'') AND
  EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_snapshots."spaceId" AND m."userId"=hosted_web_snapshots."userId")
);
CREATE POLICY hosted_web_snapshots_system ON hosted_web_snapshots USING (current_setting('app.rls_bypass',true)='on');
