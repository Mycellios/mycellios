import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// Group shared folders (specs/group-shared-folders/spec.md) against a fresh disposable loopback
// PostgreSQL cluster. Synthetic rows only: no production data, accounts, credentials or models;
// never point it at another database.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const run = promisify(execFile);
const {
  createDb,
  asSystem,
  runAsTenant,
  createGroupRepos,
  groupFolderAccess,
  GroupFolderLimitError,
  IsolationError,
} = await import("@mycellios/db");

const freePort = async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
};
const port = await freePort();
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-group-folders-"));
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
const migration = "packages/db/prisma/migrations/20261124120000_group_shared_folders/migration.sql";
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
const prismaEnv = (url: string) => ({
  ...process.env,
  DATABASE_URL: url,
  DATABASE_MIGRATION_URL: url,
});
const folderId = (seed: number) => seed.toString(16).padStart(64, "0");
try {
  await postgres.initialise();
  await postgres.start();
  const base = `postgresql://postgres:${password}@127.0.0.1:${port}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("CREATE DATABASE legacy");
  await admin.end();

  // The published schema without this migration's table, then the migration itself.
  const legacyUrl = `${base}/legacy`;
  await run(
    process.execPath,
    [prismaCli, "db", "push", "--config", "packages/db/prisma.config.ts"],
    {
      windowsHide: true,
      env: prismaEnv(legacyUrl),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const legacy = new pg.Client({ connectionString: legacyUrl });
  await legacy.connect();
  await legacy.query("DROP TABLE chat_group_folders");
  await legacy.query(await readFile(migration, "utf8"));
  const policies = await legacy.query(
    `SELECT policyname FROM pg_policies WHERE tablename = 'chat_group_folders' ORDER BY 1`,
  );
  assert.deepEqual(
    policies.rows.map((row) => row.policyname),
    ["chat_group_folders_system", "chat_group_folders_tenant"],
  );
  await assert.rejects(
    legacy.query(
      `INSERT INTO chat_group_folders (id, "groupId", "spaceId", "userId", "folderId", name, label) VALUES ('x','missing','s','u','f','n','n')`,
    ),
  );
  // Row-level security as the migration creates it. The superuser bypasses RLS, so the reads use
  // an ordinary login role; the synthetic row skips its foreign key only for this check.
  await legacy.query("SET session_replication_role = replica");
  await legacy.query(
    `INSERT INTO chat_group_folders (id, "groupId", "spaceId", "userId", "folderId", name, label) VALUES ('rls','g','space','owner','f','n','n')`,
  );
  await legacy.query("SET session_replication_role = DEFAULT");
  const tenantPassword = randomBytes(24).toString("hex");
  await legacy.query(`CREATE ROLE synthetic_tenant LOGIN PASSWORD '${tenantPassword}'`);
  await legacy.query("GRANT SELECT ON chat_group_folders TO synthetic_tenant");
  const tenant = new pg.Client({
    connectionString: `postgresql://synthetic_tenant:${tenantPassword}@127.0.0.1:${port}/legacy`,
  });
  tenant.on("error", () => undefined);
  await tenant.connect();
  const visible = async (who: { spaceId: string; userId: string } | "system" | "none") => {
    await tenant.query(
      "SELECT set_config('app.space_id', $1, false), set_config('app.user_id', $2, false), set_config('app.rls_bypass', $3, false)",
      [
        typeof who === "object" ? who.spaceId : "",
        typeof who === "object" ? who.userId : "",
        who === "system" ? "on" : "off",
      ],
    );
    return Number((await tenant.query("SELECT count(*) AS n FROM chat_group_folders")).rows[0].n);
  };
  assert.equal(await visible({ spaceId: "space", userId: "owner" }), 1);
  assert.equal(await visible({ spaceId: "space", userId: "intruder" }), 0);
  assert.equal(await visible({ spaceId: "space-2", userId: "owner" }), 0);
  assert.equal(await visible("none"), 0);
  assert.equal(await visible("system"), 1);
  await tenant.end();
  await legacy.query(`DELETE FROM chat_group_folders WHERE id = 'rls'`);
  await legacy.end();
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
    { windowsHide: true, env: prismaEnv(legacyUrl), maxBuffer: 4 * 1024 * 1024 },
  ).then(
    () => "",
    (error: { stdout?: string; code?: number }) => {
      if (error.code === 2) return error.stdout ?? "drift";
      throw error;
    },
  );
  assert.equal(diff, "", `migration drift:\n${diff}`);
  checks.push(
    "the additive migration restores the expected schema with a group foreign key, and its row-level security hides folders from other users, Spaces and unscoped reads",
  );

  const url = `${base}/postgres`;
  await run(
    process.execPath,
    [prismaCli, "db", "push", "--config", "packages/db/prisma.config.ts"],
    {
      windowsHide: true,
      env: prismaEnv(url),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-group-folders" });
  const prisma = asSystem(db.prisma, "isolated synthetic group folder acceptance");
  const scope = { spaceId: "space", userId: "owner" };
  const actor = { ...scope, role: "owner" } as never;
  await prisma.user.create({
    data: { id: "owner", name: "Synthetic owner", email: "owner@example.invalid" },
  });
  await prisma.user.create({
    data: { id: "intruder", name: "Synthetic other", email: "other@example.invalid" },
  });
  await prisma.organization.create({
    data: { id: "org", name: "Synthetic", slug: "group-folders", createdAt: new Date() },
  });
  for (const [spaceId, userId] of [
    ["space", "owner"],
    ["space-2", "owner"],
    ["space", "intruder"],
  ] as const) {
    if (!(await prisma.space.findUnique({ where: { id: spaceId } })))
      await prisma.space.create({ data: { id: spaceId, organizationId: "org", name: spaceId } });
    if (!(await prisma.member.findFirst({ where: { userId } })))
      await prisma.member.create({
        data: {
          id: `member-${userId}`,
          userId,
          organizationId: "org",
          role: "owner",
          createdAt: new Date(),
        },
      });
    await prisma.spaceMember.create({
      data: {
        id: `sm-${spaceId}-${userId}`,
        userId,
        organizationId: "org",
        spaceId,
        role: "owner",
        createdAt: new Date(),
      },
    });
  }
  const mico = (id: string, name: string) =>
    prisma.bot.create({
      data: { ...scope, id, name, color: "green", thread: { create: { ...scope } } },
    });
  await mico("ana", "Ana");
  await mico("ben", "Ben");
  await mico("cai", "Cai");
  const groups = createGroupRepos(prisma);
  const group = await groups.createGroup(actor, { name: "Site", botIds: ["ana", "ben", "cai"] });
  const other = await groups.createGroup(actor, { name: "Other", botIds: ["ana", "ben"] });

  // 1. Owner-only, Space-scoped API.
  assert.deepEqual(await groups.listGroupFolders(actor, group.id), {
    spaceId: "space",
    folders: [],
  });
  const first = await groups.addGroupFolder(actor, {
    groupId: group.id,
    folderId: folderId(1),
    name: " site ",
  });
  assert.equal(first.name, "site");
  assert.deepEqual(
    await groups.addGroupFolder(actor, {
      groupId: group.id,
      folderId: folderId(1),
      name: "renamed",
    }),
    first,
  );
  for (const intruder of [
    { spaceId: "space", userId: "intruder", role: "owner" },
    { spaceId: "space-2", userId: "owner", role: "owner" },
  ] as never[]) {
    await assert.rejects(groups.listGroupFolders(intruder, group.id), IsolationError);
    await assert.rejects(
      groups.addGroupFolder(intruder, { groupId: group.id, folderId: folderId(2), name: "x" }),
      IsolationError,
    );
    await assert.rejects(
      groups.removeGroupFolder(intruder, { groupId: group.id, folderId: folderId(1) }),
      IsolationError,
    );
  }
  assert.equal((await groups.listGroupFolders(actor, group.id)).folders.length, 1);
  assert.equal(first.label, "site");
  // Labels are assigned once, unique in the group, and listed unchanged afterwards.
  const web = await groups.addGroupFolder(actor, {
    groupId: other.id,
    folderId: folderId(40),
    name: "web",
  });
  const web2 = await groups.addGroupFolder(actor, {
    groupId: other.id,
    folderId: folderId(41),
    name: "Web",
  });
  assert.deepEqual([web.label, web2.label], ["web", "Web 2"]);
  assert.deepEqual(
    (await groups.listGroupFolders(actor, other.id)).folders.map((folder) => folder.label),
    ["web", "Web 2"],
  );
  await assert.rejects(
    prisma.chatGroupFolder.create({
      data: { groupId: other.id, ...scope, folderId: folderId(42), name: "web", label: "web" },
    }),
  );
  for (const id of [40, 41])
    await groups.removeGroupFolder(actor, { groupId: other.id, folderId: folderId(id) });
  assert.equal((await groups.listGroupFolders(actor, other.id)).folders.length, 0);
  checks.push(
    "only the group's owner in its Space lists, adds or removes its folders; adding the same id again is idempotent; labels are assigned once and unique per group",
  );

  // 2. The repositories also work under a request's own tenant context.
  assert.equal(
    (await runAsTenant(scope, () => createGroupRepos(db!.prisma).listGroupFolders(actor, group.id)))
      .folders.length,
    1,
  );
  checks.push("the repositories read a group's folders under the owner's tenant context");

  // 3. At most 8 folders, even when many adds race.
  const raced = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      groups.addGroupFolder(actor, {
        groupId: group.id,
        folderId: folderId(100 + index),
        name: `f${index}`,
      }),
    ),
  );
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 7);
  assert.ok(
    raced.every(
      (result) => result.status === "fulfilled" || result.reason instanceof GroupFolderLimitError,
    ),
  );
  assert.equal((await groups.listGroupFolders(actor, group.id)).folders.length, 8);
  checks.push("a ninth folder is refused under the group's row lock, also for concurrent adds");

  // 4. Runs: only an active member of the owner's unarchived group gets the folder ids.
  const access = (botId: string, groupId = group.id, owner = scope) =>
    groupFolderAccess(prisma, { groupId, botId, ...owner });
  assert.equal((await access("ana")).length, 8);
  assert.equal((await access("ana", other.id)).length, 0);
  assert.equal((await access("ana", group.id, { spaceId: "space", userId: "intruder" })).length, 0);
  assert.equal((await access("ana", group.id, { spaceId: "space-2", userId: "owner" })).length, 0);
  await groups.updateGroup(actor, { groupId: group.id, botIds: ["ana", "ben"] });
  assert.equal((await access("cai")).length, 0);
  await prisma.bot.update({ where: { id: "ben" }, data: { archivedAt: new Date() } });
  assert.equal((await access("ben")).length, 0);
  await prisma.bot.update({ where: { id: "ben" }, data: { archivedAt: null } });
  await groups.removeGroupFolder(actor, { groupId: group.id, folderId: folderId(1) });
  assert.ok(!(await access("ana")).some((folder) => folder.folderId === folderId(1)));
  await groups.archiveGroup(actor, group.id);
  assert.equal((await access("ana")).length, 0);
  await assert.rejects(groups.listGroupFolders(actor, group.id), IsolationError);
  await assert.rejects(
    groups.addGroupFolder(actor, { groupId: group.id, folderId: folderId(3), name: "x" }),
    IsolationError,
  );
  checks.push(
    "runs get folder ids only as active members of the owner's unarchived group; removal, leaving and archive revoke them",
  );

  // 5. Deleting a group deletes its folders.
  await groups.restoreGroup(actor, group.id);
  assert.equal((await access("ana")).length, 7);
  await groups.removeGroup(actor, group.id);
  assert.equal(await prisma.chatGroupFolder.count({ where: { groupId: group.id } }), 0);
  checks.push("deleting a group deletes its folders");

  const result = { passed: true, checks, productionAccess: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt: path.join(directory, "result.json") }, null, 2));
} finally {
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
