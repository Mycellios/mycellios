-- The local memory notes each run placed in its prompt (specs/mico-memory-graph).
-- Additive: older API and worker releases never read or write this table.
-- CreateTable
CREATE TABLE "run_memory_recalls" (
    "runId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_memory_recalls_pkey" PRIMARY KEY ("runId")
);

-- CreateIndex
CREATE INDEX "run_memory_recalls_spaceId_userId_idx" ON "run_memory_recalls"("spaceId", "userId");

-- AddForeignKey
ALTER TABLE "run_memory_recalls" ADD CONSTRAINT "run_memory_recalls_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A receipt belongs to the run's owner in one Space; nobody else sees it.
ALTER TABLE "run_memory_recalls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_memory_recalls" FORCE ROW LEVEL SECURITY;
CREATE POLICY run_memory_recalls_owner ON "run_memory_recalls" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '') AND
  EXISTS (SELECT 1 FROM space_members m WHERE m."spaceId" = "run_memory_recalls"."spaceId" AND m."userId" = "run_memory_recalls"."userId")
);
CREATE POLICY run_memory_recalls_system ON "run_memory_recalls" USING (current_setting('app.rls_bypass', true) = 'on');
