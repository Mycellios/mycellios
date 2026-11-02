BEGIN;
ALTER TABLE "agent_skills" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "agent_skill_revisions" (
 "id" TEXT PRIMARY KEY, "skillId" TEXT NOT NULL REFERENCES "agent_skills"("id") ON DELETE CASCADE,
 "spaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "name" TEXT NOT NULL, "description" TEXT NOT NULL, "content" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("skillId", "revision")
);
CREATE INDEX "agent_skill_revisions_spaceId_userId_idx" ON "agent_skill_revisions"("spaceId", "userId");
INSERT INTO "agent_skill_revisions" ("id", "skillId", "spaceId", "userId", "revision", "name", "description", "content", "createdAt")
 SELECT "id" || ':1', "id", "spaceId", "userId", 1, "name", "description", "content", "updatedAt" FROM "agent_skills";
-- Database-owned snapshots also cover old API processes during a rolling upgrade.
CREATE FUNCTION snapshot_agent_skill_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF ROW(NEW."name", NEW."description", NEW."content", NEW."source") IS NOT DISTINCT FROM ROW(OLD."name", OLD."description", OLD."content", OLD."source") THEN
   NEW."revision" := OLD."revision";
   RETURN NEW;
  END IF;
  NEW."revision" := OLD."revision" + 1;
 ELSE
  NEW."revision" := 1;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION save_agent_skill_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "agent_skill_revisions" ("id", "skillId", "spaceId", "userId", "revision", "name", "description", "content", "createdAt")
 VALUES (NEW."id" || ':' || NEW."revision", NEW."id", NEW."spaceId", NEW."userId", NEW."revision", NEW."name", NEW."description", NEW."content", NEW."updatedAt") ON CONFLICT ("skillId", "revision") DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_skill_revision_number BEFORE INSERT OR UPDATE ON "agent_skills" FOR EACH ROW EXECUTE FUNCTION snapshot_agent_skill_revision();
CREATE TRIGGER agent_skill_revision_snapshot AFTER INSERT OR UPDATE ON "agent_skills" FOR EACH ROW EXECUTE FUNCTION save_agent_skill_revision();
ALTER TABLE "agent_skill_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_skill_revisions_tenant ON "agent_skill_revisions" USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY agent_skill_revisions_system ON "agent_skill_revisions" USING (current_setting('app.rls_bypass', true) = 'on');

CREATE FUNCTION reject_agent_skill_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Skill revisions are immutable';
END $$;
CREATE TRIGGER agent_skill_revision_immutable BEFORE UPDATE ON "agent_skill_revisions" FOR EACH ROW EXECUTE FUNCTION reject_agent_skill_revision_update();
COMMIT;
