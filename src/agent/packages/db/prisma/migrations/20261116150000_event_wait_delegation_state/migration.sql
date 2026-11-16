-- Add only the durable event-wait state; all existing delegation values remain valid.
-- Compatible with the previous runtime. Roll back code without narrowing this CHECK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE tasks DROP CONSTRAINT tasks_delegation_state_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_delegation_state_check CHECK
  ("delegationState" IS NULL OR "delegationState" IN
    ('queued','running','waiting','waiting_event','completed','failed','paused','cancelled')) NOT VALID;
ALTER TABLE tasks VALIDATE CONSTRAINT tasks_delegation_state_check;
COMMIT;
