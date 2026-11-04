ALTER TABLE "threads" ADD COLUMN "taskBotId" TEXT, ADD COLUMN "projectKey" TEXT, ADD COLUMN "taskKey" TEXT, ADD COLUMN "title" TEXT;
ALTER TABLE "threads" ADD CONSTRAINT "threads_taskBotId_fkey" FOREIGN KEY ("taskBotId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "threads_spaceId_userId_taskKey_key" ON "threads"("spaceId", "userId", "taskKey");
CREATE INDEX "threads_taskBotId_projectKey_idx" ON "threads"("taskBotId", "projectKey");
ALTER TABLE "threads" DROP CONSTRAINT "threads_owner_chk";
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk" CHECK (num_nonnulls("botId", "groupId", "externalConversationId", "taskBotId") = 1);
ALTER TABLE "threads" ADD CONSTRAINT "threads_task_project_chk" CHECK (("taskBotId" IS NULL AND "taskKey" IS NULL AND "projectKey" IS NULL) OR ("taskBotId" IS NOT NULL AND "taskKey" IS NOT NULL AND "projectKey" IS NOT NULL));
