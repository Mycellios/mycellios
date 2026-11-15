CREATE UNIQUE INDEX "threads_id_spaceId_userId_key" ON threads(id,"spaceId","userId");
CREATE UNIQUE INDEX "messages_id_threadId_key" ON messages(id,"threadId");
CREATE TABLE message_pins (
  "messageId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("messageId","userId"),
  FOREIGN KEY ("messageId","threadId") REFERENCES messages(id,"threadId") ON DELETE CASCADE,
  FOREIGN KEY ("threadId","spaceId","userId") REFERENCES threads(id,"spaceId","userId") ON DELETE CASCADE
);
CREATE INDEX "message_pins_spaceId_userId_threadId_pinnedAt_idx" ON message_pins("spaceId","userId","threadId","pinnedAt");
ALTER TABLE message_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY message_pins_owner ON message_pins USING (
  "spaceId"=NULLIF(current_setting('app.space_id',true),'') AND
  "userId"=NULLIF(current_setting('app.user_id',true),'') AND
  EXISTS(SELECT 1 FROM space_members m WHERE m."spaceId"=message_pins."spaceId" AND m."userId"=message_pins."userId") AND
  EXISTS(SELECT 1 FROM threads t WHERE t.id=message_pins."threadId" AND t."spaceId"=message_pins."spaceId")
);
CREATE POLICY message_pins_system ON message_pins USING (current_setting('app.rls_bypass',true)='on');
