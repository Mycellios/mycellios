CREATE TABLE hosted_webs (
  id TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  summary TEXT NOT NULL CHECK (length(summary) <= 240),
  "draftBundle" JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "publishedRevisionId" TEXT,
  "forkedFrom" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE(id, "userId", "spaceId")
);
CREATE INDEX "hosted_webs_spaceId_userId_idx" ON hosted_webs("spaceId", "userId");
CREATE TABLE hosted_web_revisions (
  id TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 100),
  digest TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  bundle JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("siteId", number), UNIQUE("siteId", id),
  FOREIGN KEY ("siteId", "userId", "spaceId") REFERENCES hosted_webs(id,"userId","spaceId") ON DELETE CASCADE
);
CREATE FUNCTION hosted_web_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published web revisions are immutable'; END $$;
CREATE TRIGGER hosted_web_revision_immutable BEFORE UPDATE ON hosted_web_revisions
 FOR EACH ROW EXECUTE FUNCTION hosted_web_revision_immutable();
ALTER TABLE hosted_webs ADD CONSTRAINT hosted_webs_published_revision_fk
 FOREIGN KEY (id, "publishedRevisionId") REFERENCES hosted_web_revisions("siteId", id)
 DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE hosted_web_pins (
  "siteId" TEXT NOT NULL REFERENCES hosted_webs(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  PRIMARY KEY ("siteId", "userId", "spaceId")
);
CREATE TABLE hosted_web_views (
  "siteId" TEXT NOT NULL REFERENCES hosted_webs(id) ON DELETE CASCADE,
  day TEXT NOT NULL, visitor TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("siteId", day, visitor)
);
CREATE INDEX "hosted_web_views_createdAt_idx" ON hosted_web_views("createdAt");
ALTER TABLE hosted_webs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_web_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY hosted_webs_owner ON hosted_webs
 USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY hosted_web_revisions_owner ON hosted_web_revisions
 USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY hosted_web_pins_owner ON hosted_web_pins
 USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY hosted_webs_system ON hosted_webs USING (current_setting('app.rls_bypass',true)='on');
CREATE POLICY hosted_web_revisions_system ON hosted_web_revisions USING (current_setting('app.rls_bypass',true)='on');
CREATE POLICY hosted_web_pins_system ON hosted_web_pins USING (current_setting('app.rls_bypass',true)='on');
CREATE POLICY hosted_web_views_system ON hosted_web_views USING (current_setting('app.rls_bypass',true)='on');
