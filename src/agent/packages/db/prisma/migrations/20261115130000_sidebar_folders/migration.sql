ALTER TABLE "bot_sections" ADD COLUMN "parentId" TEXT;
CREATE UNIQUE INDEX "bot_sections_id_spaceId_userId_key" ON "bot_sections"("id", "spaceId", "userId");
CREATE INDEX "bot_sections_spaceId_userId_parentId_idx" ON "bot_sections"("spaceId", "userId", "parentId");
ALTER TABLE "bot_sections" ADD CONSTRAINT "bot_sections_parentId_spaceId_userId_fkey"
  FOREIGN KEY ("parentId", "spaceId", "userId") REFERENCES "bot_sections"("id", "spaceId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "bot_sections" ADD CONSTRAINT "bot_sections_no_self_parent" CHECK ("parentId" IS DISTINCT FROM "id");
