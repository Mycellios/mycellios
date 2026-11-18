-- Large per-user files for Hifa Store apps. Metadata only: bytes live sealed in the
-- artifact object store under "storageKey". Unavailable unless the operator enables
-- it; rows belong to the visiting user/Space and are deleted with the app.
CREATE TABLE hosted_web_files (
  id TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL REFERENCES hosted_webs(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  preview BOOLEAN NOT NULL,
  name TEXT NOT NULL CHECK (name ~ '^[A-Za-z0-9_.:/-]{1,200}$'),
  "mimeType" TEXT NOT NULL CHECK (length("mimeType") BETWEEN 3 AND 120),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 26214400),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("siteId", "userId", "spaceId", preview, name)
);
CREATE INDEX "hosted_web_files_spaceId_userId_idx" ON hosted_web_files ("spaceId", "userId");
ALTER TABLE hosted_web_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_files FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_web_files_owner ON hosted_web_files USING (
  "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
  "userId"=NULLIF(current_setting('app.user_id',true),'') AND
  EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=hosted_web_files."spaceId" AND m."userId"=hosted_web_files."userId")
);
CREATE POLICY hosted_web_files_system ON hosted_web_files USING (current_setting('app.rls_bypass',true)='on');
-- Every removed row (explicit delete, replacement, app/user/Space cascade) leaves a
-- tombstone so its sealed object is removed from object storage afterwards. No
-- foreign keys: tombstones must outlive the rows, user and Space they came from.
CREATE TABLE hosted_web_file_tombstones (
  "storageKey" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Not FORCEd: the SECURITY DEFINER trigger (table owner) must insert during any
-- tenant's delete; the runtime role still only reaches rows in system context.
ALTER TABLE hosted_web_file_tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY hosted_web_file_tombstones_system ON hosted_web_file_tombstones USING (current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION hosted_web_file_tombstone() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO hosted_web_file_tombstones ("storageKey", "spaceId", "userId")
  VALUES (OLD."storageKey", OLD."spaceId", OLD."userId") ON CONFLICT DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER hosted_web_file_tombstone AFTER DELETE ON hosted_web_files
 FOR EACH ROW EXECUTE FUNCTION hosted_web_file_tombstone();
