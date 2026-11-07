ALTER TABLE "runs" ADD COLUMN "cloudComputerId" TEXT;

ALTER TABLE "runs" ADD CONSTRAINT "runs_cloudComputerId_fkey"
  FOREIGN KEY ("cloudComputerId") REFERENCES "computers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
