ALTER TABLE "bots" ADD COLUMN "busyMessageMode" TEXT;
ALTER TABLE "bots" ADD CONSTRAINT "bots_busyMessageMode_check"
  CHECK ("busyMessageMode" IN ('queue', 'steer'));
