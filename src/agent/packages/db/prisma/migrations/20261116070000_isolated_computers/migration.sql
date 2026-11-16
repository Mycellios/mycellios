-- Extend the existing scope contract without reassigning or rewriting computers.
ALTER TABLE "computers"
  DROP CONSTRAINT "computers_scope_check",
  ADD CONSTRAINT "computers_scope_check"
    CHECK ("scope" IN ('team', 'dedicated', 'isolated'));
