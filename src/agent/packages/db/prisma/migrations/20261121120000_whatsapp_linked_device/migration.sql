-- WhatsApp numbers linked as devices of the owner's Mycellios Desktop
-- (specs/whatsapp-linked-device). Additive: older API releases never read these tables.
-- CreateTable
CREATE TABLE "whatsapp_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "desktopDeviceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "accountJid" TEXT NOT NULL,
    "accountLid" TEXT,
    "phone" TEXT NOT NULL,
    "pushName" TEXT,
    "status" TEXT NOT NULL,
    "groups" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_senders" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_outbound" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "chatJid" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "quotedId" TEXT,
    "quotedParticipant" TEXT,
    "emoji" TEXT,
    "targetId" TEXT,
    "targetFromMe" BOOLEAN NOT NULL DEFAULT false,
    "targetParticipant" TEXT,
    "sourceMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerHandle" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_outbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_inbound" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "chatJid" TEXT NOT NULL,
    "senderJid" TEXT NOT NULL,
    "participant" TEXT,
    "kind" TEXT NOT NULL,
    "threadMessageId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_links_accountJid_key" ON "whatsapp_links"("accountJid");

-- CreateIndex
CREATE INDEX "whatsapp_links_userId_spaceId_idx" ON "whatsapp_links"("userId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_senders_linkId_jid_key" ON "whatsapp_senders"("linkId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_outbound_idempotencyKey_key" ON "whatsapp_outbound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "whatsapp_outbound_linkId_status_createdAt_idx" ON "whatsapp_outbound"("linkId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_runId_idx" ON "whatsapp_inbound"("runId");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_threadMessageId_idx" ON "whatsapp_inbound"("threadMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_inbound_linkId_waMessageId_key" ON "whatsapp_inbound"("linkId", "waMessageId");

-- AddForeignKey
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_senders" ADD CONSTRAINT "whatsapp_senders_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "whatsapp_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_outbound" ADD CONSTRAINT "whatsapp_outbound_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "whatsapp_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "whatsapp_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Links belong to one user in one Space; senders, outbox and inbound rows inherit
-- visibility from their link (the subquery runs under the caller's own policies).
ALTER TABLE "whatsapp_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_links_owner ON "whatsapp_links" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '') AND
  EXISTS (SELECT 1 FROM space_members m WHERE m."spaceId" = "whatsapp_links"."spaceId" AND m."userId" = "whatsapp_links"."userId")
);
CREATE POLICY whatsapp_links_system ON "whatsapp_links" USING (current_setting('app.rls_bypass', true) = 'on');

DO $$
DECLARE
  child text;
BEGIN
  FOREACH child IN ARRAY ARRAY['whatsapp_senders', 'whatsapp_outbound', 'whatsapp_inbound'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', child);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM "whatsapp_links" l WHERE l."id" = %I."linkId"))',
      child || '_owner', child, child);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.rls_bypass'', true) = ''on'')',
      child || '_system', child);
  END LOOP;
END $$;
