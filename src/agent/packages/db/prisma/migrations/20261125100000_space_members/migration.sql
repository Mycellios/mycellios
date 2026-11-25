-- Space members, phase 1 (specs/space-members/spec.md): one-use invitations to a Space other than
-- Personal. Additive: the previous release never reads this table, and deleting a Space or the
-- inviting account cascades its invitations. Only the SHA-256 of a link token is stored.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "space_invitations" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,

    CONSTRAINT "space_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "space_invitations_kind_check" CHECK (
      ("kind" = 'email' AND "email" IS NOT NULL AND "email" = lower("email")) OR
      ("kind" = 'link' AND "email" IS NULL)
    ),
    CONSTRAINT "space_invitations_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "space_invitations_tokenHash_key" ON "space_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "space_invitations_spaceId_createdAt_idx" ON "space_invitations"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "space_invitations_inviterUserId_createdAt_idx" ON "space_invitations"("inviterUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant reads its Space's invitations only as that Space's owner or an admin. Accepting one
-- runs as system, because the person accepting is not a member yet.
ALTER TABLE "space_invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_invitations_tenant ON "space_invitations" USING (
  "spaceId" = NULLIF(current_setting('app.space_id', true), '') AND
  EXISTS (
    SELECT 1 FROM "space_members" m
    WHERE m."spaceId" = "space_invitations"."spaceId"
      AND m."userId" = NULLIF(current_setting('app.user_id', true), '')
      AND m."role" IN ('owner', 'admin')
  )
);
CREATE POLICY space_invitations_system ON "space_invitations"
  USING (current_setting('app.rls_bypass', true) = 'on');

-- An invited person joins one Space only. An organization's default Space is its owner's
-- Personal Space, which is never shared, so a new organization membership joins it only for an
-- owner. The previous release creates owner memberships only, so its behavior is unchanged.
CREATE OR REPLACE FUNCTION ensure_default_space_membership() RETURNS TRIGGER AS $$
BEGIN
  IF NOT ('owner' = ANY (string_to_array(replace(NEW."role", ' ', ''), ','))) THEN
    RETURN NEW;
  END IF;
  INSERT INTO "space_members" (
    "id", "spaceId", "organizationId", "userId", "role", "createdAt"
  )
  SELECT
    'default-space-member:' || NEW."id",
    space."id",
    NEW."organizationId",
    NEW."userId",
    NEW."role",
    NEW."createdAt"
  FROM "spaces" AS space
  WHERE space."organizationId" = NEW."organizationId"
    AND space."isDefault"
  ON CONFLICT ("spaceId", "userId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
