-- Webhook routines created from chat (specs/mico-automation/spec.md, phase 2): a secret a Mico
-- created from the person's message can be shown once on its chat card until "revealUntil".
-- Additive only: one nullable column without a default, so the table is not rewritten; the
-- previous release never reads it and reads every secret as one made in the editor.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "routine_webhook_secrets" ADD COLUMN "revealUntil" TIMESTAMP(3);

COMMIT;
