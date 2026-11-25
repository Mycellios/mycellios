# Invite people to a Space and share Micos with them

Status: proposed design. No product code changes with this spec.

Micos already work as teams of Micos (`specs/mico-team-messaging/spec.md`,
`specs/mico-team-build/spec.md`, `specs/agent-team-onboarding/spec.md`), and
outside people reach a Mico through messaging channels. Every Space still has
one person. This spec adds people: several accounts in one Space, with Micos
shared between them. It reuses the group routing of mico-team-messaging and the
restrictions that outside chats already have.

## Existing behavior

- Spaces are Better Auth organizations whose lifecycle belongs to the product
  RPCs. The plugin runs with `allowUserToCreateOrganization: false`,
  `isBlockedAuthPath` closes every `/organization*` route, and the API answers
  404 "Not available in version 1" (`packages/auth/src/index.ts`,
  `apps/api/src/app.ts`).
- Each account gets its own `Organization`, an `owner` `Member`, a default
  Personal Space with the same id and an `owner` `SpaceMember`
  (`packages/db/src/bootstrap-user.ts`). `spaces.create`, `rename` and `remove`
  manage up to 32 Spaces in that organization; only an owner renames or deletes
  one (`packages/db/src/spaces.ts`).
- The schema already has `Member.role`, `SpaceMember.role` (default `member`) and
  an unused `Invitation` model (email, role, status, expiry, inviter)
  (`packages/db/prisma/schema.prisma`). No RPC gives another account a
  membership. The only invite RPC is `referrals.invite`, a sign-up referral worth
  1 Credit for 14 days (`packages/contracts/src/referrals.ts`); the hosted closed
  beta admits new accounts through its own sign-up invitation (`signupInvite`).
- `requireMembership` builds the actor from any `SpaceMember` row that the
  `space-id` header names (`packages/db/src/scope.ts`). A second member would be
  admitted and see nothing: Micos, groups and almost every read filter on
  `userId: actor.userId` as well as `spaceId` (`listBots` and `getBot` in
  `packages/db/src/repos.ts`; 441 such filters in 88 files). The Space switcher
  lists only Spaces of the current Space's organization (`memberSpaceNavigation`
  in `apps/api/src/routes/spaces.ts`).
- Row-level security stops at the Space: tenant policies compare `spaceId` with
  `app.space_id` on threads, messages, memory, artifacts, bots, runs and
  computers; model and voice credentials compare `userId` with `app.user_id`
  (`20261021140000_row_level_security`,
  `20261022120000_row_level_security_tenant_tables`). Content is encrypted with
  one data key per Space, wrapped by a server master key (`SpaceKey`).
- A run executes as its Mico's owner: `claimMicoRun` locks the Mico by the run's
  `userId` (`packages/db/src/mico-concurrency.ts`), and the model connection is
  that owner's, so the owner pays in Credits or on their own provider.
- Messages carry `role` and `botId`, not a human author (`Message`). Groups belong
  to one owner and their members are Micos (`ChatGroup`, `ChatGroupMember.botId`).
  Outside chats (`ExternalConversation`) let other people talk to a Mico through
  messaging channels, with no personal memory tools and no memory review
  (`messagingChannelRun` in `packages/adapters/src/executor.ts`).

The reference desktop app (behavior reference only; PolyForm Noncommercial, no
copied code, prompts or text) lets a server's owner invite people by one-use
link, QR code or email, with owner, admin and member roles; nobody changes or
removes the owner. Each agent has a level per member (none, view, chat, manage;
owners and admins always manage), set through an Everyone role and custom roles,
and a member's turn reaches only the agents that member can chat with. Channels
are chats every member reads and writes, with the author on each message. An
audit log keeps membership, role and access changes. Members' turns use the
host owner's provider sign-ins, which its own provider-terms page rates as high
risk for subscription plans.

## Decision

A Space other than Personal can have several people. A person always uses a
shared Mico in their own conversations, the turns run on the Mico owner's
resources under limits the owner sets, and nothing private to the owner reaches
a member. Five phases, each shipping alone; phases 2 to 5 need phase 1.

1. Phase 1 — members and shared Micos.
   - The owner of a Space other than Personal invites by email or by a one-use
     link, each valid 7 days and revocable. Accepting needs a signed-in account
     (the invited address for an email invitation) and creates a `Member` in the
     owner's organization and a `SpaceMember` with role `member`. New product
     RPCs (`spaces.members.*`, `spaces.invites.*`) own this; the organization
     routes stay closed.
   - Roles: `owner` (the creator, never changed or removed), `admin` (invites,
     removes and shares) and `member`. A Space holds at most 20 people.
   - The Space switcher lists every Space the account belongs to, across
     organizations, with the owner's name. The default Space stays the account's
     own Personal Space, and `spaces.create` always uses the account's own
     organization (today it uses the current Space's, which would be the owner's).
   - The owner or an admin shares a Mico with chosen members or with everyone
     (level `chat`; the default for every Mico is `none`). A member sees a shared
     Mico's name, avatar and title, never its settings, instructions, memory,
     skills, connections or computer.
   - A member talks to a shared Mico only in their own conversations: ordinary
     side conversations of that Mico (`Thread.taskBotId`) owned by the Mico's
     owner, with an additive `memberUserId`. The owner's main chat is never shared.
     Messages get an additive `authorUserId`; runs an additive `requestedByUserId`.
   - Member access is resolved once per request for the procedures a member may
     call (bootstrap, history, send, answer, stop, files of that conversation).
     Those run with the owner's tenant identity and the member as author; every
     other procedure keeps the member's own identity. The owner filters stay.
   - Leaving or removal deletes the membership; `requireMembership` reads it on
     every request, so access ends at once. The person's queued turns are
     cancelled; their messages stay with their name.
   - A Space audit log for the owner and admins records invitations, joins,
     leaves, removals, role changes and shares in `security_events` with the Space
     id, keeping the names of the moment.
   - Implemented (1a): behind `MYCELLIOS_SPACE_MEMBERS_ENABLED`, invitations
     (`space_invitations`, hashed one-use tokens), roles, leaving, removal, the
     audit log (`spaces.members.audit`), the switcher's shared Spaces and a Members
     section; a non-owner reaches only `spaces.members.*`/`spaces.invites.*` in a
     shared Space until Mico sharing and member conversations land.
   - Implemented (1b, server): behind the same flag, `mico_shares` with
     `spaces.shares.*`, and `sharedMicos.*` for a member's own conversations
     (`memberUserId`, `authorUserId`, `requestedByUserId`) run as the Mico owner's
     tenant. Member turns get the restricted policy on Pi and hosted Credits only,
     holding against a per-member UTC-day allowance (default 1 Credit; 0 pauses).
     The owner reads, never writes, those conversations; unsharing, removal and
     leaving cancel queued turns; the invitation says the owner can read them. The
     sharing and conversation screens, the audit view and the deletion count follow.
2. Phase 2 — work tools for members.
   - A member's turns on a shared Mico get their own home on that Mico's server
     computer (a home key per Mico and member), so their files never meet the
     owner's or another member's. Shell, file and browser tools run there under the
     Space's approval rules, and the member answers approvals for that workspace.
   - A This PC Mico never runs a member's turn on the owner's PC; those turns use
     the per-member server home, or stay text-only where the deployment has no
     sandboxes.
3. Phase 3 — people in group chats.
   - A group in a shared Space can include people as well as Micos. Every person
     in it reads and writes, messages show their author, and each person has their
     own read position and notifications.
   - Routing stays deterministic (mico-team-messaging: mentions, `@everyone`, an
     opening name, else the lead). A person's message reaches only the Micos that
     person can chat with; others are skipped without being named.
   - Group shared folders keep their rule: only turns the owner started carry them.
4. Phase 4 — view, manage and roles.
   - Levels become `none`, `view` (read the group chats and conversations the
     owner marks shared), `chat` and `manage` (edit instructions, skills, routines
     and model within the owner's connections). Owners and admins always manage;
     deleting a Mico, payer and caps stay with the owner.
   - An Everyone level and named roles set levels for many members; the highest
     level wins. Saves carry the revision they read and fail on a newer one.
   - Admins can create Micos in the Space; such a Mico belongs to the Space owner
     (`userId`) and records who created it.
5. Phase 5 — payment options.
   - Per shared Mico on the Mycellios provider, the owner chooses who pays for
     member turns: the owner (default) or each member, on the member's own
     Mycellios connection with ordinary Credit admission and receipts. A Mico on
     the owner's own API key can only be paid by the owner.

Open decisions, with the default to confirm before phase 1:

- Payer: the Mico's owner, with a daily allowance per member set when sharing
  (default 1 Credit per UTC day; 0 stops sends), enforced at admission.
- Oversight: the Mico's owner can open members' conversations with that Mico,
  because they run on the owner's resources; the invitation says so. Admins who
  do not own the Mico cannot.
- The Personal Space cannot be shared.
- During the closed beta an invitation gives no sign-up place.
- At most 20 people per Space, set by the operator.

Rejected:

- Opening Better Auth's organization routes to clients. They would bypass the
  Space rules that the product RPCs enforce.
- Turning Micos into Space-owned rows and rewriting the owner filters. Resolving
  access once per request for a fixed set of procedures is smaller and safer.
- Serving member turns with the owner's subscription sign-ins (ChatGPT or Claude
  OAuth, CLIs on the owner's PC). Those plans assume individual use.
- Per-member client-held keys. The server must read content to run a Mico;
  authorization is the boundary, as it already is inside a Space.
- A pooled Space wallet. It needs a new funding source in the Credits ledger.
- Company sign-in and SCIM. Revisit after phase 4.

## Rules

- Member-started turns never receive the owner's general or Mico memory, memory
  writes or reviews, connected accounts, secrets or `fill_secret`, PC tools,
  schedules, routines or workflows. `message_bot` and groups reach only Micos the
  member can chat with.
- A member sees the Space name, its people (emails only for the owner and
  admins), the Micos shared with them and the conversations and files they can
  open. Search returns only those conversations.
- Every request rechecks membership and level; removal and unsharing take effect
  on the next request and stop the person's queued turns.
- Encryption stays one key per Space on the server. No key reaches a client, and
  removing a person needs no re-keying because no person ever held one.
- Deleting a shared Space deletes it for every member after a confirmation that
  names how many; deleting the owner's account deletes their shared Spaces.
- Member turns keep run fences, receipts, approvals and the no-replay rule.
  Their usage is recorded on the payer with `requestedByUserId`.
- All schema changes are additive and keep working with the previous release.

## Verification

- Phase 1: an isolated PostgreSQL verifier (`scripts/verify-space-members-db.ts`)
  for one-use and expired invitations, binding to the signed-in address, removal
  ending access on the next request, a member's tenant reading none of the owner's
  private rows (unshared Micos, memory, artifacts, credentials) and the audit
  rows; RPC tests for roles (nobody removes the owner); executor tests for the
  member tool policy and the daily allowance; UI tests for invite, accept and the
  switcher. Real email delivery is reported separately.
- Phase 2: home-key tests proving member, owner and other-member files stay
  apart, and supervisor tests for the per-member home.
- Phase 3: routing tests with people as authors, per-person read positions and
  notifications, extending `scripts/verify-mico-requests-db.ts`.
- Phase 4: the level matrix per procedure, role merging and revision conflicts.
- Phase 5: payer selection, no fallback to another payer, and the managed
  purchases suite on isolated PostgreSQL.
