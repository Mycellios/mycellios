CREATE TABLE "task_inbox" (
 "id" TEXT PRIMARY KEY,
 "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE,
 "threadId" TEXT NOT NULL UNIQUE REFERENCES "threads"("id") ON DELETE CASCADE,
 "clientNonce" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "readSeq" INTEGER NOT NULL DEFAULT -1,
 "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("spaceId","userId","clientNonce")
);
CREATE INDEX "task_inbox_owner_idx" ON "task_inbox"("spaceId","userId","createdAt");
ALTER TABLE "task_inbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_inbox_tenant ON "task_inbox" USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY task_inbox_system ON "task_inbox" USING (current_setting('app.rls_bypass',true)='on');
