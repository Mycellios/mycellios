BEGIN;
SET LOCAL lock_timeout = '5s';
-- The Chrome profile session (sha256 of its id) that sent an owner message: only that
-- browser's shared tabs reach the turn it starts (specs/agent-chrome-tabs). Nullable, no rewrite.
ALTER TABLE messages ADD COLUMN "browserSessionKey" TEXT;
COMMIT;
