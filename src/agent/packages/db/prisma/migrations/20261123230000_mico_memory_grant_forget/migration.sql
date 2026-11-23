-- Personal memory writes (specs/mcp-memory, phase 3): a Mico with read_write access may
-- also forget entries when its owner allows it. Additive: the previous release ignores it.
ALTER TABLE "mico_memory_grants" ADD COLUMN "allowForget" BOOLEAN NOT NULL DEFAULT false;
