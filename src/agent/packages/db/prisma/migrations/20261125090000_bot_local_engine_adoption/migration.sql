-- When the one-time move of a This PC Mico to a CLI signed in on its PC happened, so it never
-- repeats or overrides a later choice. Additive: the previous release never reads this column.
ALTER TABLE "bots" ADD COLUMN "localEngineAdoptedAt" TIMESTAMP(3);
