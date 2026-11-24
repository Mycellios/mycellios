-- Group shared folders (specs/group-shared-folders/spec.md): an opaque id and a display name
-- per folder the owner granted on a PC. Native paths never reach the server. Additive only:
-- the previous release never reads this table, and deleting a group cascades its rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "chat_group_folders" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_group_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_group_folders_groupId_folderId_key" ON "chat_group_folders"("groupId", "folderId");

-- CreateIndex
CREATE INDEX "chat_group_folders_spaceId_userId_idx" ON "chat_group_folders"("spaceId", "userId");

-- AddForeignKey
ALTER TABLE "chat_group_folders" ADD CONSTRAINT "chat_group_folders_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_group_folders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_group_folders_tenant ON "chat_group_folders" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  "userId" = NULLIF(current_setting('app.user_id', true), '')
);
CREATE POLICY chat_group_folders_system ON "chat_group_folders"
  USING (current_setting('app.rls_bypass', true) = 'on');

COMMIT;
