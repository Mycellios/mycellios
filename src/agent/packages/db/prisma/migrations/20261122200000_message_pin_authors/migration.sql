-- A pin a Mico made in its own conversation for the person who owns that conversation.
-- Additive and nullable: NULL is the person's own pin, so every existing pin keeps its
-- meaning, and code without this column still lists and removes these rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE message_pins ADD COLUMN "pinnedByBotId" TEXT;
ALTER TABLE message_pins ADD CONSTRAINT "message_pins_pinnedByBotId_fkey"
  FOREIGN KEY ("pinnedByBotId") REFERENCES bots(id) ON DELETE CASCADE;
-- One Mico's pins across its main chat and side conversations, newest first.
CREATE INDEX "message_pins_spaceId_userId_pinnedAt_idx" ON message_pins("spaceId","userId","pinnedAt");
CREATE INDEX "message_pins_pinnedByBotId_idx" ON message_pins("pinnedByBotId");

COMMIT;
