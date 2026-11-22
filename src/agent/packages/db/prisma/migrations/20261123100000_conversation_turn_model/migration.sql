BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE runs ADD COLUMN "modelExecution" JSONB;

COMMIT;
