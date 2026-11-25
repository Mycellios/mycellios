import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TransactionalEmail } from "@mycellios/adapter-kit";
import { legacyEnvName } from "@mycellios/core/legacy-env";
import { createRouterClient } from "@orpc/server";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// Space members, phase 1 (specs/space-members/spec.md), against a fresh disposable loopback
// PostgreSQL cluster: every migration applied by the owner as a deploy does, then a runtime login
// without superuser or row-level security bypass, and the actual RPC router on top. Synthetic
// accounts only: no production data, credentials, email delivery or models; never point it at
// another database.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const run = promisify(execFile);
const db = await import("@mycellios/db");
const { createRouter } = await import("../apps/api/src/router.js");
type RouterDeps = import("../apps/api/src/router.js").RouterDeps;

const freePort = async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
};
const port = await freePort();
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-space-members-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});
const prismaCli = path.resolve("node_modules/prisma/build/index.js");
const ownerUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
const runtimePassword = randomBytes(24).toString("hex");
const runtimeUrl = `postgresql://space_members_runtime:${runtimePassword}@127.0.0.1:${port}/postgres`;
// Only this cluster: never the checkout's own .env.
const prismaEnv = {
  ...process.env,
  DATABASE_URL: ownerUrl,
  DATABASE_MIGRATION_URL: ownerUrl,
  [legacyEnvName("PROJECT_LOCAL")]: "1",
};
let handle: ReturnType<typeof db.createDb> | undefined;
const checks: string[] = [];

/** The ORPC code a call failed with; a scoped read that found nothing is NOT_FOUND. */
async function failure(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof db.IsolationError) return "NOT_FOUND";
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw error;
  }
  throw new Error("expected the call to fail");
}

try {
  await postgres.initialise();
  await postgres.start();

  // 1. The actual migration history, as the owner. The history carries older drift in other
  // tables; this change must add none.
  await run(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--config", "packages/db/prisma.config.ts"],
    {
      windowsHide: true,
      env: prismaEnv,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const diff = await run(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--config",
      "packages/db/prisma.config.ts",
      "--from-config-datasource",
      "--to-schema",
      "packages/db/prisma/schema.prisma",
      "--exit-code",
    ],
    { windowsHide: true, env: prismaEnv, maxBuffer: 16 * 1024 * 1024 },
  ).then(
    () => "",
    (error: { stdout?: string; code?: number }) => {
      if (error.code === 2) return error.stdout ?? "drift";
      throw error;
    },
  );
  assert.ok(!diff.includes("space_invitations"), `space_invitations drift:\n${diff}`);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const policies = await owner.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'space_invitations' ORDER BY 1`,
    );
    assert.deepEqual(
      policies.rows.map((row) => row.policyname),
      ["space_invitations_system", "space_invitations_tenant"],
    );
    const secured = await owner.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'space_invitations'`,
    );
    assert.equal(secured.rows[0]?.relrowsecurity, true);
    // The organization trigger: an owner still joins the default Space, an invited member never.
    await owner.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES
        ('trigger-owner', 'Owner', 'trigger-owner@example.invalid', true, now(), now()),
        ('trigger-guest', 'Guest', 'trigger-guest@example.invalid', true, now(), now());
      INSERT INTO organization (id, name, slug, "createdAt") VALUES ('trigger-org', 'Personal', 'trigger-org', now());
      INSERT INTO spaces (id, "organizationId", name, "isDefault") VALUES ('trigger-org', 'trigger-org', 'Personal', true);
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES
        ('trigger-owner-member', 'trigger-org', 'trigger-owner', 'owner', now()),
        ('trigger-guest-member', 'trigger-org', 'trigger-guest', 'member', now());
    `);
    const joined = await owner.query(
      `SELECT "userId", role FROM space_members WHERE "spaceId" = 'trigger-org' ORDER BY 1`,
    );
    assert.deepEqual(joined.rows, [{ userId: "trigger-owner", role: "owner" }]);
    await owner.query(
      `DELETE FROM organization WHERE id = 'trigger-org'; DELETE FROM "user" WHERE id LIKE 'trigger-%'`,
    );
  } finally {
    await owner.end();
  }
  checks.push(
    "every migration applies as the owner and the new table matches the Prisma schema; invitations have tenant and system row-level security; a new organization owner still joins its default Space while an invited member never joins the owner's Personal Space",
  );

  // 2. The runtime login the API uses: no superuser, no row-level security bypass.
  const provisioned = await db.provisionRuntimeRole(ownerUrl, runtimeUrl);
  assert.equal(provisioned.warning, undefined);
  handle = db.createDb(runtimeUrl, {
    encryptContent: false,
    applicationName: "space-members-qualification",
  });
  const prisma = handle.prisma;
  const system = db.asSystem(prisma, "synthetic Space member fixtures");
  db.installSecurityEventStore(prisma);
  const sentEmails: TransactionalEmail[] = [];
  const routerDeps = (spaceMembers: { limit: number } | undefined) =>
    ({
      prisma,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "https://app.example.invalid/agent",
        screenProxySecret: "synthetic-screen-proxy-secret",
        sandboxProvider: "fake",
        agentRuntime: "scripted",
        spaceMembers,
      },
      email: {
        describe: () => ({ id: "synthetic", kind: "email", capabilities: { transactional: true } }),
        send: async (message: TransactionalEmail) => {
          sentEmails.push(message);
        },
      },
      dataDir: path.join(directory, "data"),
    }) as unknown as RouterDeps;
  const router = createRouter(routerDeps({ limit: 3 }));
  const routerOff = createRouter(routerDeps(undefined));
  /** The RPC client a request gets: the actor and role `requireMembershipWithRole` admits. */
  async function rpcAs(userId: string, spaceId?: string, off = false) {
    const { actor, spaceRole } = await db.requireMembershipWithRole(
      prisma,
      userId,
      spaceId ?? null,
    );
    return createRouterClient(off ? routerOff : router, { context: { actor, spaceRole } });
  }
  async function account(id: string, name: string, emailVerified = true) {
    await system.user.create({
      data: { id, name, email: `${id}@example.invalid`, emailVerified },
    });
    const { spaceId } = await db.runAsSystem("synthetic sign-up", () =>
      db.bootstrapUserSpace(
        prisma,
        { id },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    return spaceId;
  }
  const anaPersonal = await account("ana", "Ana Synthetic");
  const benPersonal = await account("ben", "Ben Synthetic");
  await account("cai", "Cai Synthetic", false);
  await account("dan", "Dan Synthetic");
  await account("fay", "Fay Synthetic");
  const team = (
    await db.runAsSystem("create a Space for its member", () =>
      db.createSpaceForMember(prisma, {
        currentSpaceId: anaPersonal,
        userId: "ana",
        name: "Launch",
      }),
    )
  ).id;
  const anaOrg = (await system.space.findUniqueOrThrow({ where: { id: team } })).organizationId;
  assert.equal(anaOrg, anaPersonal);

  // The owner's private rows in the shared Space and on the account.
  const anaScope = { spaceId: team, userId: "ana" };
  await system.bot.create({
    data: {
      ...anaScope,
      id: "ana-planner",
      name: "Planner",
      color: "#3EC5A8",
      thread: { create: { ...anaScope } },
    },
  });
  await system.memoryDocument.create({
    data: {
      ...anaScope,
      scope: "bot",
      path: "bots/ana-planner/MEMORY.md",
      content: "Private plans",
    },
  });
  await system.artifact.create({
    data: {
      ...anaScope,
      id: "ana-report",
      name: "report.md",
      mimeType: "text/markdown",
      size: 4,
      hash: "0".repeat(64),
      storageKey: "synthetic/ana-report",
    },
  });
  const accountSecret = await system.secret.create({
    data: { userId: "ana", kind: "model", ciphertext: "synthetic-ciphertext" },
  });
  await system.userModelCredential.create({
    data: { userId: "ana", provider: "synthetic", label: "Ana key", secretId: accountSecret.id },
  });
  const spaceSecret = await system.secret.create({
    data: {
      userId: "ana",
      spaceId: team,
      kind: "agent-environment",
      ciphertext: "synthetic-ciphertext",
    },
  });
  await system.agentSecret.create({
    data: { spaceId: team, createdByUserId: "ana", name: "DEPLOY_TOKEN", secretId: spaceSecret.id },
  });

  // 3. Off unless the operator enables it.
  const anaOff = await rpcAs("ana", team, true);
  assert.equal(await failure(anaOff.spaces.members.list()), "NOT_FOUND");
  assert.equal(await failure(anaOff.spaces.invites.create({ kind: "link" })), "NOT_FOUND");
  assert.equal((await (await rpcAs("ana", undefined, true)).spaces.list()).sharedSpaces, undefined);
  checks.push(
    "while Space members are off, every membership procedure answers NOT_FOUND and navigation is unchanged",
  );

  // 4. One-use links, for any signed-in account.
  const anaTeam = await rpcAs("ana", team);
  assert.equal(
    await failure((await rpcAs("ana")).spaces.invites.create({ kind: "link" })),
    "FORBIDDEN",
  );
  const link = await anaTeam.spaces.invites.create({ kind: "link" });
  const linkToken = new URL(link.url).hash.slice(1);
  assert.match(link.url, /^https:\/\/app\.example\.invalid\/agent\/join#[A-Za-z0-9_-]{43}$/);
  assert.equal(
    await system.spaceInvitation.count({
      where: { tokenHash: db.spaceInviteTokenHash(linkToken) },
    }),
    1,
  );
  assert.equal(await system.spaceInvitation.count({ where: { tokenHash: linkToken } }), 0);
  const benOwn = await rpcAs("ben");
  assert.deepEqual(
    {
      ...(await benOwn.spaces.invites.preview({ token: linkToken })),
      expiresAt: "checked",
    },
    {
      spaceId: team,
      spaceName: "Launch",
      ownerName: "Ana Synthetic",
      invitedBy: "Ana Synthetic",
      expiresAt: "checked",
      member: false,
    },
  );
  assert.deepEqual(await benOwn.spaces.invites.accept({ token: linkToken }), { spaceId: team });
  assert.equal(
    (
      await system.member.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: anaOrg, userId: "ben" } },
      })
    ).role,
    "member",
  );
  assert.equal(
    (
      await system.spaceMember.findUniqueOrThrow({
        where: { spaceId_userId: { spaceId: team, userId: "ben" } },
      })
    ).role,
    "member",
  );
  assert.equal(
    await system.spaceMember.count({ where: { spaceId: anaPersonal, userId: "ben" } }),
    0,
  );
  assert.equal(
    await failure((await rpcAs("fay")).spaces.invites.accept({ token: linkToken })),
    "NOT_FOUND",
  );
  assert.equal(await failure(benOwn.spaces.invites.preview({ token: linkToken })), "NOT_FOUND");
  checks.push(
    "a one-use link joins one signed-in account as a member of the owner's organization and of that Space only, never the Personal Space; a second use fails; only the token's SHA-256 is stored",
  );

  // 5. The default stays the account's own Personal Space; Spaces it creates stay in its organization.
  const benDefault = await db.requireMembershipWithRole(prisma, "ben", null);
  assert.deepEqual([benDefault.actor.spaceId, benDefault.spaceRole], [benPersonal, "owner"]);
  assert.equal((await db.requireMembershipWithRole(prisma, "ben", team)).spaceRole, "member");
  const benSpace = await db.runAsSystem("create a Space for its member", () =>
    db.createSpaceForMember(prisma, { currentSpaceId: team, userId: "ben", name: "Mine" }),
  );
  assert.equal(
    (await system.space.findUniqueOrThrow({ where: { id: benSpace.id } })).organizationId,
    benPersonal,
  );
  checks.push(
    "without a requested Space a member still opens their own Personal Space, and a Space they create goes to their own organization even from a shared one",
  );

  // 6. A member reaches only the membership procedures in the shared Space.
  const benTeam = await rpcAs("ben", team);
  for (const call of [
    () => benTeam.me(),
    () => benTeam.bootstrap({}),
    () => benTeam.bots.list(),
    () => benTeam.bots.get({ botId: "ana-planner" }),
    () => benTeam.memory.list({}),
    () => benTeam.artifacts.list({ botId: "ana-planner" }),
    () => benTeam.models.credentials(),
    () => benTeam.agentSecrets.list(),
    () => benTeam.spaces.list(),
    () => benTeam.spaces.create({ name: "Inside" }),
    () => benTeam.spaceSettings.overrides(),
  ])
    assert.equal(await failure(call()), "FORBIDDEN");
  const benView = await benTeam.spaces.members.list();
  assert.deepEqual(
    benView.people.map((person) => [person.userId, person.role, person.email, person.you]),
    [
      ["ana", "owner", "ana@example.invalid", false],
      ["ben", "member", "ben@example.invalid", true],
    ],
  );
  assert.deepEqual([benView.role, benView.invitations], ["member", []]);
  for (const call of [
    () => benTeam.spaces.invites.create({ kind: "link" }),
    () => benTeam.spaces.members.remove({ userId: "ana" }),
    () => benTeam.spaces.members.setRole({ userId: "ben", role: "admin" }),
    () => benTeam.spaces.members.audit({}),
  ])
    assert.equal(await failure(call()), "FORBIDDEN");
  checks.push(
    "in a Space someone else owns a member reaches only its people and invitations: chats, Micos, memory, credentials, secrets, settings and Space creation all answer FORBIDDEN",
  );

  // 7. None of the owner's private rows reach the member, through repositories or row security.
  const benTenant = { spaceId: team, userId: "ben" };
  const benActor = (await db.requireMembershipWithRole(prisma, "ben", team)).actor;
  const repos = db.createRepos(prisma);
  assert.deepEqual(await db.runAsTenant(benTenant, () => repos.listBots(benActor)), []);
  assert.equal(
    await failure(db.runAsTenant(benTenant, () => repos.getBot(benActor, "ana-planner"))),
    "NOT_FOUND",
  );
  assert.equal(
    await db.runAsTenant(benTenant, () =>
      prisma.userModelCredential.count({ where: { userId: "ana" } }),
    ),
    0,
  );
  assert.equal(
    await db.runAsTenant(benTenant, () => prisma.secret.count({ where: { spaceId: null } })),
    0,
  );
  const benNavigation = await benOwn.spaces.list();
  assert.deepEqual(benNavigation.sharedSpaces, [
    { id: team, name: "Launch", role: "member", ownerName: "Ana Synthetic" },
  ]);
  assert.deepEqual(
    benNavigation.spaces.map((space) => space.id).sort(),
    [benPersonal, benSpace.id].sort(),
  );
  assert.ok(!JSON.stringify(benNavigation).includes("ana-planner"));
  const anaNavigation = await (await rpcAs("ana")).spaces.list();
  assert.ok(anaNavigation.spaces.some((space) => space.id === team));
  assert.deepEqual(anaNavigation.sharedSpaces, []);
  checks.push(
    "the member reads none of the owner's Micos, memory, artifacts or credentials: owner-filtered repositories return nothing, account credentials stay behind row security, and navigation lists the shared Space only by name and owner",
  );

  // 8. Email invitations bind the signed-in, verified address.
  const emailed = await anaTeam.spaces.invites.create({
    kind: "email",
    email: "CAI@Example.invalid",
  });
  assert.equal(emailed.invitation.email, "cai@example.invalid");
  assert.equal(emailed.emailSent, true);
  assert.equal(sentEmails.at(-1)?.to, "cai@example.invalid");
  assert.ok(sentEmails.at(-1)?.text.includes(emailed.url));
  const emailToken = new URL(emailed.url).hash.slice(1);
  assert.equal(
    await failure((await rpcAs("dan")).spaces.invites.accept({ token: emailToken })),
    "FORBIDDEN",
  );
  const caiOwn = await rpcAs("cai");
  assert.equal(await failure(caiOwn.spaces.invites.accept({ token: emailToken })), "FORBIDDEN");
  await system.user.update({ where: { id: "cai" }, data: { emailVerified: true } });
  assert.deepEqual(await caiOwn.spaces.invites.accept({ token: emailToken }), { spaceId: team });
  checks.push(
    "an email invitation is sent through the configured provider and accepted only by that address once verified; another account is refused",
  );

  // 9. At most the operator's limit of people, invitations included.
  assert.equal(await failure(anaTeam.spaces.invites.create({ kind: "link" })), "CONFLICT");
  checks.push("a Space holds at most the operator's limit of people, counting pending invitations");

  // 10. Roles: nobody removes or changes the owner; admins remove members only.
  await anaTeam.spaces.members.setRole({ userId: "ben", role: "admin" });
  const benAdmin = await rpcAs("ben", team);
  assert.equal((await benAdmin.spaces.members.list()).role, "admin");
  assert.equal(
    await failure(benAdmin.spaces.members.setRole({ userId: "cai", role: "admin" })),
    "FORBIDDEN",
  );
  assert.equal(await failure(benAdmin.spaces.members.remove({ userId: "ana" })), "FORBIDDEN");
  assert.equal(await failure(anaTeam.spaces.members.remove({ userId: "ana" })), "FORBIDDEN");
  assert.equal(
    await failure(anaTeam.spaces.members.setRole({ userId: "ana", role: "member" })),
    "FORBIDDEN",
  );
  assert.equal(await failure(anaTeam.spaces.members.leave()), "FORBIDDEN");
  const afterRemoval = await benAdmin.spaces.members.remove({ userId: "cai" });
  assert.deepEqual(
    afterRemoval.people.map((person) => person.userId),
    ["ana", "ben"],
  );
  checks.push(
    "the owner is never removed, demoted or able to leave; only the owner changes roles; an admin removes members",
  );

  // 11. Removal ends access on the next request.
  await assert.rejects(db.requireMembershipWithRole(prisma, "cai", team), db.IsolationError);
  assert.equal(await system.member.count({ where: { organizationId: anaOrg, userId: "cai" } }), 0);
  checks.push(
    "removal deletes the membership, so the next request in that Space is refused, and the organization membership it no longer needs",
  );

  // 12. Expired and revoked invitations open nothing.
  const expiring = await benAdmin.spaces.invites.create({ kind: "link" });
  await system.spaceInvitation.update({
    where: { id: expiring.invitation.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const danOwn = await rpcAs("dan");
  assert.equal(
    await failure(danOwn.spaces.invites.accept({ token: new URL(expiring.url).hash.slice(1) })),
    "NOT_FOUND",
  );
  const revoked = await anaTeam.spaces.invites.create({ kind: "link" });
  await anaTeam.spaces.invites.revoke({ invitationId: revoked.invitation.id });
  assert.equal(
    await failure(danOwn.spaces.invites.accept({ token: new URL(revoked.url).hash.slice(1) })),
    "NOT_FOUND",
  );
  checks.push("expired and revoked invitations cannot be opened or accepted");

  // 13. Invitations are readable only by the Space's owner and admins.
  const invitations = await system.spaceInvitation.count({ where: { spaceId: team } });
  assert.ok(invitations >= 4);
  assert.equal(
    await db.runAsTenant({ spaceId: team, userId: "ana" }, () => prisma.spaceInvitation.count()),
    invitations,
  );
  assert.equal(
    await db.runAsTenant({ spaceId: team, userId: "ben" }, () => prisma.spaceInvitation.count()),
    invitations,
  );
  assert.equal(
    await db.runAsTenant({ spaceId: team, userId: "dan" }, () => prisma.spaceInvitation.count()),
    0,
  );
  assert.equal(
    await db.runAsTenant({ spaceId: benPersonal, userId: "ben" }, () =>
      prisma.spaceInvitation.count(),
    ),
    0,
  );
  checks.push("row-level security shows a Space's invitations to its owner and admins only");

  // 14. Leaving.
  await benAdmin.spaces.members.leave();
  await assert.rejects(db.requireMembershipWithRole(prisma, "ben", team), db.IsolationError);
  assert.deepEqual((await benOwn.spaces.list()).sharedSpaces, []);
  checks.push("leaving ends access at once and the Space leaves the switcher");

  // 15. The audit log keeps the names of the moment, never addresses, for the owner and admins.
  const audit = await anaTeam.spaces.members.audit({});
  const byType = (type: string) => audit.filter((event) => event.type === type);
  assert.equal(byType("space.member.joined").length, 2);
  assert.deepEqual(
    byType("space.member.role_changed").map((event) => [
      event.actorName,
      event.targetName,
      event.role,
    ]),
    [["Ana Synthetic", "Ben Synthetic", "admin"]],
  );
  assert.deepEqual(
    byType("space.member.removed").map((event) => [event.actorName, event.targetName]),
    [["Ben Synthetic", "Cai Synthetic"]],
  );
  assert.deepEqual(
    byType("space.member.left").map((event) => event.targetName),
    ["Ben Synthetic"],
  );
  assert.equal(byType("space.invitation.revoked").length, 1);
  assert.ok(byType("space.invitation.created").some((event) => event.kind === "email"));
  const stored = await system.securityEvent.findMany({ where: { spaceId: team } });
  assert.ok(stored.length >= 8);
  assert.ok(!JSON.stringify(stored.map((event) => event.metadata)).includes("@"));
  const danInvite = await anaTeam.spaces.invites.create({ kind: "link" });
  assert.deepEqual(
    await danOwn.spaces.invites.accept({ token: new URL(danInvite.url).hash.slice(1) }),
    {
      spaceId: team,
    },
  );
  assert.equal(await failure((await rpcAs("dan", team)).spaces.members.audit({})), "FORBIDDEN");
  checks.push(
    "invitations, joins, role changes, removals and leaving are audited in security_events with the Space and names of the moment, no addresses, readable by the owner and admins only",
  );

  // 16. Deleting a shared Space ends its members' organization membership.
  const side = (
    await db.runAsSystem("create a Space for its member", () =>
      db.createSpaceForMember(prisma, { currentSpaceId: anaPersonal, userId: "ana", name: "Side" }),
    )
  ).id;
  const sideLink = await (await rpcAs("ana", side)).spaces.invites.create({ kind: "link" });
  await (await rpcAs("fay")).spaces.invites.accept({ token: new URL(sideLink.url).hash.slice(1) });
  const claim = await db.runAsSystem("delete a Space", () =>
    db.claimSpaceDeletionForMember(prisma, {
      currentSpaceId: anaPersonal,
      userId: "ana",
      spaceId: side,
    }),
  );
  await db.runAsSystem("delete a Space", () =>
    db.deleteClaimedSpaceForMember(prisma, {
      currentSpaceId: anaPersonal,
      userId: "ana",
      spaceId: side,
      claimId: claim.claimId,
    }),
  );
  assert.equal(await system.member.count({ where: { organizationId: anaOrg, userId: "fay" } }), 0);
  assert.equal(await system.member.count({ where: { organizationId: anaOrg, userId: "dan" } }), 1);
  checks.push(
    "deleting a shared Space removes its people and the organization memberships it alone gave them",
  );

  // 17. Deleting the owner's account deletes the Spaces it shared, with their people.
  assert.deepEqual(await db.personalOrganizationIds(prisma, "ana"), [anaOrg]);
  assert.deepEqual(await db.personalOrganizationIds(prisma, "dan"), [
    (await system.member.findFirstOrThrow({ where: { userId: "dan", role: "owner" } }))
      .organizationId,
  ]);
  const leaving = await db.runAsSystem("account deletion", () =>
    db.claimSpacesLeavingWithAccount(prisma, "ana"),
  );
  assert.ok(leaving.includes(team) && leaving.includes(anaPersonal));
  // The API destroys each bot first (destroyBot); these synthetic ones have no computer.
  await system.bot.deleteMany({ where: { spaceId: { in: leaving } } });
  for (const spaceId of leaving) {
    const deleted = await db.runAsSystem("account deletion", () =>
      db.deleteSpaceLeavingWithAccount(prisma, { spaceId, userId: "ana" }),
    );
    assert.ok(deleted);
  }
  assert.equal(await system.space.count({ where: { id: team } }), 0);
  assert.equal(await system.spaceMember.count({ where: { userId: "dan", spaceId: team } }), 0);
  checks.push(
    "deleting the owner's account claims and deletes the Spaces it shared even with members inside, and only its own organization goes with it",
  );

  const result = { passed: true, checks, productionAccess: false, emailDelivery: "not run" };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt: path.join(directory, "result.json") }, null, 2));
} finally {
  await handle?.prisma.$disconnect().catch(() => undefined);
  await handle?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
