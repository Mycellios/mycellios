-- Places taken from the deployment's invitation link, at most SIGNUP_INVITE_LIMIT per code.
-- Additive: older API releases never read it. System-only, like "user" and verification. No foreign key: the
-- place is claimed while signup may still hold the new user row uncommitted.
CREATE TABLE signup_invite_redemptions (
  "userId" TEXT PRIMARY KEY,
  "inviteId" TEXT NOT NULL CHECK ("inviteId" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "signup_invite_redemptions_inviteId_idx" ON signup_invite_redemptions ("inviteId");
