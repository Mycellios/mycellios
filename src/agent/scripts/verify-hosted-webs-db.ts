import { executeHostedAppTool } from "../packages/adapters/src/hosted-app-tools.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Script } from "node:vm";
import type { Actor } from "@rakazo/contracts";
import {
  asSystem,
  createDb,
  LocalKeyProvider,
  listHostedWebs,
  runAsTenant,
} from "@rakazo/db";
import EmbeddedPostgres from "embedded-postgres";
import { ANTSEED_RADAR_HTML } from "../apps/api/src/hosted-webs/antseed-template.js";
import { hostedWebHttp } from "../apps/api/src/hosted-webs/http.js";
import { createWebPreview } from "../apps/api/src/hosted-webs/preview.js";
import { hostedWebService } from "../apps/api/src/hosted-webs/service.js";

process.env.RAKAZO_PROJECT_LOCAL = "1";
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-hosted-webs-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: () => {},
});
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  const embedded = ANTSEED_RADAR_HTML.match(/<script>([\s\S]+)<\/script>/)![1]!;
  const result = new Script(
    `${embedded.split("const byId")[0]}\nparseSnapshot({peers:[]});`,
  ).runInNewContext();
  assert.equal(result.offers.length, 0);
  checks.push(
    "actual tsx/server emitted Antseed script runs without external compiler helpers",
  );
  await database.initialise();
  await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--config",
      "packages/db/prisma.config.ts",
    ],
    {
      windowsHide: true,
      env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url },
      maxBuffer: 1024 * 1024,
    },
  );
  const sql = database.getPgClient();
  await sql.connect();
  try {
    // Recreate only this feature from its actual migration, not a db-push approximation.
    await sql.query(
      "DROP TABLE hosted_web_agents,hosted_web_pins,hosted_web_views,hosted_web_revisions,hosted_webs CASCADE",
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261111210000_hosted_webs/migration.sql",
        "utf8",
      ),
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261111213000_hosted_web_membership/migration.sql",
        "utf8",
      ),
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261111220000_hosted_web_agents/migration.sql",
        "utf8",
      ),
    );
    await sql.query(
      `CREATE ROLE hosted_web_test LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO hosted_web_test; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO hosted_web_test`,
    );
  } finally {
    await sql.end();
  }
  checks.push(
    "actual feature migration applied to fresh loopback PostgreSQL; runtime role has no superuser or RLS bypass",
  );
  const runtimeUrl = `postgresql://hosted_web_test:${password}@127.0.0.1:${port}/postgres`;
  db = createDb(runtimeUrl, {
    encryptContent: true,
    keyProvider: new LocalKeyProvider([
      { id: "synthetic", key: randomBytes(32) },
    ]),
    applicationName: "hosted-webs-qualification",
  });
  const prisma = db.prisma,
    system = asSystem(prisma, "synthetic hosted website fixtures");
  const org = randomUUID(),
    firstSpace = randomUUID(),
    secondSpace = randomUUID();
  await system.organization.create({
    data: { id: org, name: "Synthetic", slug: org, createdAt: new Date() },
  });
  for (const id of [firstSpace, secondSpace])
    await system.space.create({
      data: { id, organizationId: org, name: "Synthetic" },
    });
  const owner = { userId: randomUUID(), spaceId: firstSpace } as Actor;
  const foreign = { userId: randomUUID(), spaceId: firstSpace } as Actor;
  const crossSpace = { userId: owner.userId, spaceId: secondSpace } as Actor;
  for (const actor of [owner, foreign]) {
    await system.user.create({
      data: {
        id: actor.userId,
        name: "Synthetic",
        email: `${actor.userId}@example.invalid`,
      },
    });
    await system.member.create({
      data: {
        id: randomUUID(),
        organizationId: org,
        userId: actor.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
  }
  for (const actor of [owner, foreign, crossSpace])
    await system.spaceMember.create({
      data: {
        id: randomUUID(),
        ...actor,
        organizationId: org,
        role: "member",
        createdAt: new Date(),
      },
    });
  const service = hostedWebService(prisma);
  const id = randomUUID();
  const coverPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
  const bundle = {
    files: [
      {path:"mycellios-cover.png",base64:coverPng.toString("base64")},
      {
        path: "index.html",
        base64: Buffer.from(
          "<!doctype html><title>Public utility</title><h1>public-v1</h1>",
        ).toString("base64"),
      },
      {
        path: "main.js",
        base64: Buffer.from("console.log('works')").toString("base64"),
      },
    ],
  };
  const saved = await service.save(owner, {
    id,
    version: 0,
    slug: "synthetic-utility",
    title: "Public utility",
    summary: "Synthetic public information",
    bundle,
  });
  assert.equal(saved.version, 1);
  const encrypted = await runAsTenant(
    owner,
    () =>
      prisma.$queryRaw<
        Array<{ draftBundle: unknown }>
      >`SELECT "draftBundle" FROM hosted_webs WHERE id=${id}`,
  );
  assert.ok(!JSON.stringify(encrypted).includes(bundle.files.find(file=>file.path==="index.html")!.base64));
  assert.equal(
    (await service.draft(owner, id)).bundle.files.find(file=>file.path==="index.html")!.base64,
    bundle.files.find(file=>file.path==="index.html")!.base64,
  );
  assert.equal((await listHostedWebs(prisma, null, "discover")).length, 0);
  assert.equal((await service.list(owner, "discover", "")).length, 0);
  assert.equal((await service.list(owner, "mine", "")).length, 1);
  checks.push(
    "private draft source round-trips through Space encryption and is absent from public directory",
  );
  for (const actor of [foreign, crossSpace]) {
    await assert.rejects(service.draft(actor, id));
    await assert.rejects(
      service.save(actor, { ...saved, id, title: "tampered" }),
    );
    await assert.rejects(service.publish(actor, id, saved.version));
    await assert.rejects(service.unpublish(actor, id));
    assert.equal(
      await runAsTenant(actor, () => prisma.hostedWeb.count({ where: { id } })),
      0,
    );
  }
  assert.equal(await prisma.hostedWeb.count(), 0);
  await assert.rejects(service.publish(owner, id, 99));
  checks.push(
    "foreign account, same-user other Space and missing RLS context cannot read or mutate draft/publication; stale publish rejected",
  );
  await service.publish(owner, id, 1);
  const publicRows = await listHostedWebs(prisma, null, "discover");
  assert.equal(publicRows.length, 1);
  assert.ok(!JSON.stringify(publicRows).includes(owner.userId));
  assert.ok(!JSON.stringify(publicRows).includes(firstSpace));
  assert.equal(publicRows[0]!.views, 0);
  assert.equal(publicRows[0]!.revision, 1);
  assert.equal(publicRows[0]!.coverPath,"mycellios-cover.png");
  assert.ok(publicRows[0]!.coverRevisionId);
  const app = hostedWebHttp(
    prisma,
    randomBytes(32).toString("hex"),
    () => "192.0.2.8",
  );
  const request = async (
    p: string,
    method = "GET",
    agent = "Synthetic browser",
  ) => {
    const url = `http://localhost${p}`,
      init = { method, headers: { "User-Agent": agent } };
    const response = await app.request(url, init);
    return response.status === 302
      ? app.request(
          new URL(response.headers.get("location")!, url).toString(),
          init,
        )
      : response;
  };
  const root = "/api/published-webs/synthetic-utility/";
  const publicCover=await request(`${root}_versions/${publicRows[0]!.coverRevisionId}/mycellios-cover.png`);
  assert.equal(publicCover.status,200);assert.equal(publicCover.headers.get("content-type"),"image/png");
  assert.deepEqual(Buffer.from(await publicCover.arrayBuffer()),coverPng);
  checks.push("creator-owned cover is served from the immutable published revision; foreign accounts cannot change its bundle and public DTO exposes no account identity");
  const firstRedirect = await app.request(`http://localhost${root}`);
  assert.equal(firstRedirect.status, 302);
  assert.match(
    (await app.request(`http://localhost${root}?mode=estimate`)).headers.get(
      "location",
    )!,
    /index.html\?mode=estimate$/,
  );
  const firstVersionPath = new URL(
    firstRedirect.headers.get("location")!,
    `http://localhost${root}`,
  ).pathname;
  assert.equal(
    (await request("/api/published-webs")).headers.get("location"),
    "./published-webs/",
  );
  assert.equal(
    (await request(root.slice(0, -1))).headers.get("location"),
    "./synthetic-utility/",
  );
  assert.match(
    await (await request("/api/published-webs/")).text(),
    /href="\.\/synthetic-utility\/"/,
  );
  const response = await request(root);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /public-v1/);
  assert.match(
    response.headers.get("content-security-policy")!,
    /sandbox allow-scripts;/,
  );
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  await request(root);
  await request(root, "HEAD");
  await request(root + "main.js");
  await request(root, "GET", "Crawler Bot");
  assert.equal((await listHostedWebs(prisma, null, "trending"))[0]!.views, 1);
  assert.equal((await request(root + "missing.js")).status, 404);
  assert.equal((await request(root + ".env")).status, 404);
  assert.equal((await request(root, "POST")).status, 404);
  checks.push(
    "published document and assets served anonymously with mandatory sandbox/CORS; views deduplicate and ignore HEAD/assets/bots/errors",
  );
  const secondBundle = {
    files: [
      {
        path: "index.html",
        base64: Buffer.from("<h1>private-v2</h1>").toString("base64"),
      },
    ],
  };
  const edited = await service.save(owner, {
    ...saved,
    title: "Edited draft",
    bundle: secondBundle,
  });
  assert.equal(edited.version, 2);
  assert.equal((await listHostedWebs(prisma,null,"discover"))[0]!.coverPath,"mycellios-cover.png","unpublished cover removal must not alter the public card");
  assert.match(await (await request(root)).text(), /public-v1/);
  assert.equal(
    (await listHostedWebs(prisma, null, "discover"))[0]!.title,
    "Public utility",
  );
  await assert.rejects(
    service.save(owner, { ...saved, title: "stale overwrite" }),
  );
  const capability = createWebPreview(owner, id, edited.version, edited.bundle);
  const preview = await request(capability.path);
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /private-v2/);
  assert.equal((await listHostedWebs(prisma, null, "discover"))[0]!.views, 1);
  const clone = await service.clone(foreign, id, randomUUID());
  assert.equal(clone.published, false);
  assert.ok(
    Buffer.from(clone.bundle.files.find(file=>file.path==="index.html")!.base64, "base64")
      .toString()
      .includes("public-v1"),
  );
  await service.save(foreign, {
    ...clone,
    title: "Independent clone",
    bundle: secondBundle,
  });
  assert.match(await (await request(root)).text(), /public-v1/);
  await service.pin(foreign, id, true);
  assert.equal((await service.list(foreign, "pinned", "")).length, 1);
  assert.equal((await service.list(owner, "pinned", "")).length, 0);
  await service.publish(owner, id, edited.version);
  assert.equal((await listHostedWebs(prisma,null,"discover")).find(row=>row.id===id)!.coverPath,null,"explicit publication applies the creator's cover removal");
  await service.publish(owner, id, edited.version);
  assert.equal(
    (await listHostedWebs(prisma, null, "discover"))[0]!.revision,
    2,
  );
  assert.match(await (await request(root)).text(), /private-v2/);
  assert.match(await (await request(firstVersionPath)).text(), /public-v1/);
  assert.match(
    await (await request(firstVersionPath.replace("index.html", ""))).text(),
    /public-v1/,
  );
  assert.equal(
    (await request(firstVersionPath.replace("index.html", "main.js"))).status,
    200,
  );
  const revision = await system.hostedWebRevision.findFirstOrThrow({
    where: { siteId: id },
  });
  await assert.rejects(
    system.hostedWebRevision.update({
      where: { id: revision.id },
      data: { title: "mutated frozen revision" },
    }),
  );
  checks.push(
    "CAS saves, immutable reviewed publication, independent published-source cloning, scoped pins and idempotent unchanged publish verified",
  );
  await system.spaceMember.delete({
    where: { spaceId_userId: { spaceId: owner.spaceId, userId: owner.userId } },
  });
  await assert.rejects(service.draft(owner, id));
  assert.equal(
    await runAsTenant(owner, () => prisma.hostedWeb.count({ where: { id } })),
    0,
  );
  assert.equal((await request(capability.path)).status, 404);
  checks.push(
    "revoked membership blocks owner service and previously issued private preview capability",
  );
  await system.spaceMember.create({
    data: {
      id: randomUUID(),
      ...owner,
      organizationId: org,
      role: "member",
      createdAt: new Date(),
    },
  });
  // Real database, real assignment and real tool handlers. No model/provider impersonation.
  const botA = await system.bot.create({
    data: { ...owner, name: "App editor", color: "#398c69" },
  });
  const botB = await system.bot.create({
    data: { ...owner, name: "Unassigned editor", color: "#398c69" },
  });
  const foreignBot = await system.bot.create({
    data: { ...foreign, name: "Foreign editor", color: "#398c69" },
  });
  const appDraft = await service.save(owner, {
    id: randomUUID(),
    version: 0,
    slug: "agent-edit-test",
    title: "Agent test",
    summary: "Synthetic",
    bundle,
  });
  await assert.rejects(
    service.assignAgent(foreign, appDraft.id, foreignBot.id),
  );
  await assert.rejects(service.assignAgent(crossSpace, appDraft.id, botA.id));
  await assert.rejects(service.assignAgent(owner, appDraft.id, foreignBot.id));
  const binding = (await service.assignAgent(owner, appDraft.id, botA.id))!;
  assert.equal(
    (await service.agent(owner, appDraft.id))!.threadId,
    binding.threadId,
  );
  const task = await system.task.create({
    data: {
      ...owner,
      botId: botA.id,
      threadId: binding.threadId,
      prompt: "Synthetic tool qualification",
      status: "running",
    },
  });
  const run = await system.run.create({
    data: {
      ...owner,
      botId: botA.id,
      threadId: binding.threadId,
      taskId: task.id,
      status: "running",
      trigger: "user",
    },
  });
  const toolContext = { ...owner, botId: botA.id, runId: run.id };
  const read = await executeHostedAppTool(
    prisma,
    "app_read",
    { path: "index.html" },
    toolContext,
  );
  assert.equal(read.version, 1);
  assert.ok("content" in read && read.content!.includes("public-v1"));
  await service.publish(owner, appDraft.id, 1);
  const editArgs = {
    path: "index.html",
    content: "<h1>Live agent draft</h1>",
    expectedVersion: 1,
  };
  const editedByAgent = await executeHostedAppTool(
    prisma,
    "app_write",
    editArgs,
    toolContext,
  );
  assert.equal(editedByAgent.version, 2);
  assert.equal(await service.revision(owner, appDraft.id), 2);
  const changedDraft = await service.draft(owner, appDraft.id);
  assert.ok(changedDraft.bundle.files.some((f) => f.path === "main.js"));
  const livePreview = createWebPreview(
    owner,
    changedDraft.id,
    changedDraft.version,
    changedDraft.bundle,
  );
  assert.match(
    await (await request(livePreview.path)).text(),
    /Live agent draft/,
  );
  assert.match(
    await (await request("/api/published-webs/agent-edit-test/")).text(),
    /public-v1/,
  );
  await assert.rejects(
    executeHostedAppTool(prisma, "app_write", editArgs, toolContext),
    /version conflict/,
  );
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_write",
      { ...editArgs, expectedVersion: 2, path: ".env", content: "secret" },
      toolContext,
    ),
  );
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_read",
      {},
      { ...toolContext, botId: botB.id },
    ),
  );
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_read",
      {},
      { ...toolContext, ...foreign },
    ),
  );
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_read",
      {},
      { ...toolContext, ...crossSpace },
    ),
  );
  await system.bot.update({
    where: { id: botA.id },
    data: { archivedAt: new Date() },
  });
  await assert.rejects(
    executeHostedAppTool(prisma, "app_read", {}, toolContext),
  );
  await system.bot.update({
    where: { id: botA.id },
    data: { archivedAt: null },
  });
  await system.run.update({
    where: { id: run.id },
    data: { status: "cancelled" },
  });
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_write",
      { ...editArgs, expectedVersion: 2 },
      toolContext,
    ),
  );
  await system.run.update({
    where: { id: run.id },
    data: { status: "running" },
  });
  await service.assignAgent(owner, appDraft.id, botB.id);
  await assert.rejects(
    executeHostedAppTool(prisma, "app_read", {}, toolContext),
  );
  await service.assignAgent(owner, appDraft.id, botA.id);
  await service.assignAgent(owner, appDraft.id, null);
  await assert.rejects(
    executeHostedAppTool(
      prisma,
      "app_write",
      { ...editArgs, expectedVersion: 2 },
      toolContext,
    ),
  );
  await service.unpublish(owner, appDraft.id);
  checks.push(
    "assigned Mico/run/thread edits encrypted draft and live preview; unassigned, foreign, cross-Space, archived, stopped and revoked access denied; CAS preserves manual edits; public revision unchanged",
  );
  await service.unpublish(owner, id);
  assert.equal((await request(root)).status, 404);
  assert.equal((await request(firstVersionPath)).status, 404);
  checks.push(
    "document and relative asset URLs retain the same revision across publication; withdrawal revokes historical version URLs",
  );
  assert.equal((await listHostedWebs(prisma, null, "discover")).length, 0);
  await service.publish(owner, id, edited.version);
  await system.user.delete({ where: { id: owner.userId } });
  assert.equal((await request(root)).status, 404);
  assert.equal(
    (await service.draft(foreign, clone.id)).title,
    "Independent clone",
  );
  checks.push(
    "account deletion cascades through a published revision without breaking independently owned clones",
  );
  const receipt = { ok: true, checks, synthetic: true, production: false };
  await mkdir("outputs", { recursive: true });
  await writeFile(
    "outputs/hosted-webs-db-receipt.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  try {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  } finally {
    await database.stop();
  }
}
