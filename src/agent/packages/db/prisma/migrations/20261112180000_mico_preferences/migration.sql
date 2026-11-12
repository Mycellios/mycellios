ALTER TABLE "user" ADD COLUMN "micoDefaults" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "micoSettingsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bots" ADD COLUMN "micoPreferences" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "threads" ADD COLUMN "agentContextReset" JSONB;
