CREATE INDEX CONCURRENTLY "model_credit_entries_organizationId_runId_desktopTool_idx"
  ON "model_credit_entries" ("organizationId", "runId", "desktopTool");
