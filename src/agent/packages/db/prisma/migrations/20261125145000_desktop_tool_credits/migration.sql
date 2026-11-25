ALTER TABLE "runs" ADD COLUMN "desktopToolCreditLimitMicros" INTEGER;
ALTER TABLE "runs" ADD CONSTRAINT "runs_desktop_tool_credit_limit_check"
  CHECK ("desktopToolCreditLimitMicros" BETWEEN 1 AND 100000);
ALTER TABLE "model_credit_entries" ADD COLUMN "desktopTool" BOOLEAN NOT NULL DEFAULT false;
