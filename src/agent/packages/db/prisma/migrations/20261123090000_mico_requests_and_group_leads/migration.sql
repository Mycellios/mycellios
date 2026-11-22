-- Groups get a purpose and a lead the person chooses; Micos track who still owes an answer to
-- a request sent to several of them. Additive only: nullable columns and two new tables.
-- Code without them keeps routing to the first member and delivering every answer at once.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE chat_groups ADD COLUMN purpose TEXT;
ALTER TABLE chat_groups ADD COLUMN "leadBotId" TEXT;
ALTER TABLE chat_groups ADD CONSTRAINT "chat_groups_leadBotId_fkey"
  FOREIGN KEY ("leadBotId") REFERENCES bots(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "chat_groups_leadBotId_idx" ON chat_groups("leadBotId");

-- A message_bot request or send_to_group brief that waits for answers. Ids and states only.
CREATE TABLE bot_message_requests (
  id TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "senderBotId" TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "senderThreadId" TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "senderRunId" TEXT,
  "groupId" TEXT,
  "resumeRunId" TEXT,
  "settledAt" TIMESTAMP(3),
  "hiddenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bot_message_requests_resumeRunId_key" ON bot_message_requests("resumeRunId");
CREATE INDEX "bot_message_requests_senderThreadId_createdAt_idx" ON bot_message_requests("senderThreadId","createdAt");
CREATE INDEX "bot_message_requests_spaceId_userId_idx" ON bot_message_requests("spaceId","userId");

CREATE TABLE bot_message_recipients (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES bot_message_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "runId" TEXT REFERENCES runs(id) ON DELETE SET NULL ON UPDATE CASCADE,
  state TEXT NOT NULL DEFAULT 'asked' CHECK (state IN ('asked','replied','failed','stopped')),
  "answerMessageId" TEXT,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bot_message_recipients_runId_key" ON bot_message_recipients("runId");
CREATE UNIQUE INDEX "bot_message_recipients_requestId_botId_key" ON bot_message_recipients("requestId","botId");
CREATE INDEX "bot_message_recipients_state_createdAt_idx" ON bot_message_recipients(state,"createdAt");

ALTER TABLE bot_message_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_message_requests_tenant ON bot_message_requests USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY bot_message_requests_system ON bot_message_requests
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE bot_message_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_message_recipients_tenant ON bot_message_recipients USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY bot_message_recipients_system ON bot_message_recipients
  USING (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
