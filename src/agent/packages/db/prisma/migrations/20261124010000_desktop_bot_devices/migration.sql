-- The PC an owner last chose for a Mico, so several online PCs stay resolved after
-- API or Desktop restarts. Additive: the previous release never reads this table.
CREATE TABLE "desktop_bot_devices" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_bot_devices_pkey" PRIMARY KEY ("spaceId","userId","botId")
);

-- CreateIndex
CREATE INDEX "desktop_bot_devices_botId_idx" ON "desktop_bot_devices"("botId");

-- AddForeignKey
ALTER TABLE "desktop_bot_devices" ADD CONSTRAINT "desktop_bot_devices_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desktop_bot_devices" ADD CONSTRAINT "desktop_bot_devices_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "desktop_bot_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY desktop_bot_devices_tenant ON "desktop_bot_devices" USING ("spaceId"=NULLIF(current_setting('app.space_id',true),'') AND "userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY desktop_bot_devices_system ON "desktop_bot_devices" USING (current_setting('app.rls_bypass',true)='on');
