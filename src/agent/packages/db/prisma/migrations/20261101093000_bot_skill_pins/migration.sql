BEGIN;
CREATE TABLE "bot_skill_pins" (
 "id" TEXT PRIMARY KEY, "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
 "skillId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "spaceId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 FOREIGN KEY ("skillId", "revision") REFERENCES "agent_skill_revisions"("skillId", "revision") ON DELETE CASCADE,
 UNIQUE("botId", "skillId")
);
CREATE INDEX "bot_skill_pins_spaceId_userId_idx" ON "bot_skill_pins"("spaceId", "userId");
ALTER TABLE "bot_skill_pins" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_skill_pins_tenant ON "bot_skill_pins" USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY bot_skill_pins_system ON "bot_skill_pins" USING (current_setting('app.rls_bypass', true) = 'on');
COMMIT;
