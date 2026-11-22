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
import type { Actor } from "@mycellios/contracts";
import {
  asSystem,
  createDb,
  LocalKeyProvider,
  listHostedWebs,
  runAsTenant,
} from "@mycellios/db";
import EmbeddedPostgres from "embedded-postgres";
import { ANTSEED_RADAR_HTML } from "../apps/api/src/hosted-webs/antseed-template.js";
import { hostedWebHttp } from "../apps/api/src/hosted-webs/http.js";
import { createWebPreview } from "../apps/api/src/hosted-webs/preview.js";
import { hostedWebDataService } from "../apps/api/src/hosted-webs/data.js";
import {
  hostedWebFilesConfig,
  hostedWebFilesService,
  sweepHostedWebFiles,
} from "../apps/api/src/hosted-webs/files.js";
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
      "DROP TABLE IF EXISTS hosted_web_data, hosted_web_snapshots, hosted_web_files, hosted_web_file_tombstones CASCADE",
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261118170000_hosted_web_data/migration.sql",
        "utf8",
      ),
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261118190000_hosted_web_snapshots/migration.sql",
        "utf8",
      ),
    );
    await sql.query(
      await readFile(
        "packages/db/prisma/migrations/20261118210000_hosted_web_files/migration.sql",
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
  const publishedText = await (await request(root)).text();
  assert.match(publishedText, /public-v1/);
  // The cursor locator is preview-only: published documents never carry it.
  assert.doesNotMatch(publishedText, /mycellios-preview-locator/);
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
  const previewText = await preview.text();
  assert.match(previewText, /private-v2/);
  assert.match(previewText, /mycellios-preview-locator/);
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
  assert.ok(
    (await service.history(owner, appDraft.id)).some((row) => row.source === "mico"),
    "Mico edits are recorded in the draft history",
  );
  // Team work: a Mico delegated from the bound request edits the same draft; no one else does.
  await system.run.update({
    where: { id: run.id },
    data: { status: "completed" },
  });
  const team = (await service.assignAgent(owner, appDraft.id, botA.id))!;
  const leadTask = await system.task.create({
    data: {
      ...owner,
      botId: botA.id,
      threadId: team.threadId,
      prompt: "Synthetic team request",
      status: "running",
      delegationState: "waiting",
    },
  });
  const leadRun = await system.run.create({
    data: {
      ...owner,
      botId: botA.id,
      threadId: team.threadId,
      taskId: leadTask.id,
      status: "running",
      trigger: "user",
    },
  });
  const delegated = async (resources: string[]) => {
    const thread = await system.thread.create({
      data: {
        ...owner,
        taskBotId: botB.id,
        projectKey: `work:${leadTask.id}`,
        taskKey: `delegation:${randomUUID()}`,
        title: "Synthetic delegated part",
      },
    });
    const childTask = await system.task.create({
      data: {
        ...owner,
        botId: botB.id,
        threadId: thread.id,
        prompt: "Synthetic delegated part",
        status: "running",
        parentTaskId: leadTask.id,
        delegationRootId: leadTask.id,
        delegationKey: randomUUID(),
        delegationState: "running",
        expectedResult: "Synthetic result",
        resources,
      },
    });
    const childRun = await system.run.create({
      data: {
        ...owner,
        botId: botB.id,
        threadId: thread.id,
        taskId: childTask.id,
        status: "running",
        trigger: "delegated_task",
      },
    });
    await system.task.update({
      where: { id: childTask.id },
      data: { delegatedRunId: childRun.id },
    });
    return {
      task: childTask,
      context: { ...owner, botId: botB.id, runId: childRun.id },
    };
  };
  const styles = await delegated(["site:styles.css"]);
  const pageWork = await delegated(["site:index.html"]);
  const leadContext = { ...owner, botId: botA.id, runId: leadRun.id };
  // The team comes from real run states: the lead and both delegated teammates are running.
  assert.deepEqual(
    (await service.team(owner, appDraft.id)).members.map((m) => [m.botId, m.state]).sort(),
    [[botA.id, "running"], [botB.id, "running"]].sort(),
  );
  await assert.rejects(service.team(foreign, appDraft.id));
  const signals: unknown[] = [];
  const record = (presence: unknown) => {
    signals.push(presence);
  };
  const teamRead = await executeHostedAppTool(prisma, "app_read", { path: "index.html" }, pageWork.context, record);
  assert.deepEqual(signals.at(-1), {
    siteId: appDraft.id,
    path: "index.html",
    phase: "reading",
    target: { kind: "file", value: "index.html" },
  });
  const pageHash = "sha256" in teamRead ? teamRead.sha256 : undefined;
  assert.match(pageHash ?? "", /^[0-9a-f]{64}$/);
  assert.ok("files" in teamRead && teamRead.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const teamVersion = teamRead.version;
  // Two teammates write different files from the same version: both are kept.
  await executeHostedAppTool(prisma, "app_write", {
    path: "styles.css", content: "h1{color:teal}", expectedVersion: teamVersion, expectedFileSha256: "absent",
  }, styles.context, record);
  assert.deepEqual(signals.at(-1), {
    siteId: appDraft.id,
    path: "styles.css",
    phase: "writing",
    target: { kind: "selector", value: "h1" },
  });
  const pageWrite = await executeHostedAppTool(prisma, "app_write", {
    path: "index.html", content: "<h1>Team draft</h1>", expectedVersion: teamVersion, expectedFileSha256: pageHash,
  }, pageWork.context, record);
  assert.equal((signals.at(-1) as { phase: string }).phase, "writing");
  const signalCount = signals.length;
  assert.equal(pageWrite.version, teamVersion + 2);
  const teamDraft = await service.draft(owner, appDraft.id);
  const text = (path: string) => Buffer.from(teamDraft.bundle.files.find((f) => f.path === path)!.base64, "base64").toString("utf8");
  assert.equal(text("styles.css"), "h1{color:teal}");
  assert.equal(text("index.html"), "<h1>Team draft</h1>");
  // A stale file hash, a repeated "absent" or a stale version without a hash never overwrite.
  await assert.rejects(executeHostedAppTool(prisma, "app_write", {
    path: "index.html", content: "<h1>Lost</h1>", expectedVersion: pageWrite.version, expectedFileSha256: pageHash,
  }, pageWork.context), /version conflict/);
  await assert.rejects(executeHostedAppTool(prisma, "app_write", {
    path: "styles.css", content: "h1{}", expectedVersion: pageWrite.version, expectedFileSha256: "absent",
  }, styles.context), /version conflict/);
  await assert.rejects(executeHostedAppTool(prisma, "app_write", {
    path: "styles.css", content: "h1{}", expectedVersion: teamVersion,
  }, leadContext), /version conflict/);
  assert.equal((await executeHostedAppTool(prisma, "app_read", {}, leadContext)).version, pageWrite.version);
  // A run that is not the started run of a live child of this request has no access.
  const strayTask = await system.task.create({
    data: { ...owner, botId: botB.id, threadId: pageWork.task.threadId, prompt: "Synthetic unrelated", status: "running" },
  });
  const strayRun = await system.run.create({
    data: { ...owner, botId: botB.id, threadId: pageWork.task.threadId, taskId: strayTask.id, status: "running", trigger: "user" },
  });
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, { ...owner, botId: botB.id, runId: strayRun.id }));
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, { ...styles.context, ...foreign }, record));
  // Refused or conflicting calls publish no presence.
  assert.equal(signals.length, signalCount);
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, { ...styles.context, ...crossSpace }));
  await system.task.update({ where: { id: styles.task.id }, data: { paused: true } });
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, styles.context));
  await system.task.update({ where: { id: styles.task.id }, data: { paused: false, workStopPending: true } });
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, styles.context));
  await system.task.update({ where: { id: leadTask.id }, data: { delegationState: "cancelled" } });
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, pageWork.context));
  await system.task.update({ where: { id: leadTask.id }, data: { delegationState: "waiting" } });
  await executeHostedAppTool(prisma, "app_read", {}, pageWork.context);
  await system.bot.update({ where: { id: botB.id }, data: { archivedAt: new Date() } });
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, pageWork.context));
  await system.bot.update({ where: { id: botB.id }, data: { archivedAt: null } });
  // Reassigning or removing the app's Mico revokes the whole delegated tree at once.
  await service.assignAgent(owner, appDraft.id, null);
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, pageWork.context));
  await assert.rejects(executeHostedAppTool(prisma, "app_read", {}, leadContext));
  checks.push(
    "team members come from real run states and only the owner reads them; presence is published only after authorized reads/writes, with the changed selector; the preview locator never reaches published documents",
    "delegated Micos of the bound request share its draft; different files from one version are both kept, stale file hashes and versions are rejected; unrelated, foreign, cross-Space, paused, stopping, cancelled, archived and revoked access denied",
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
  // Per-user app data: capability-gated, caller-scoped, encrypted, quota-bound.
  const data = hostedWebDataService(prisma);
  const storageApp = await service.save(owner, {
    id: randomUUID(),
    version: 0,
    slug: "storage-test",
    title: "Storage test",
    summary: "Synthetic",
    bundle,
  });
  const live = { id: storageApp.id, preview: false };
  const draftTarget = { id: storageApp.id, preview: true };
  await assert.rejects(data.set(owner, { ...draftTarget, key: "p", value: 1 }), /permiso/);
  const granted = await service.save(owner, {
    ...storageApp,
    version: storageApp.version,
    bundle: { ...bundle, capabilities: ["storage"] },
  });
  await data.set(owner, { ...draftTarget, key: "p", value: { draft: true } });
  await assert.rejects(data.get(foreign, { ...draftTarget, key: "p" }));
  await assert.rejects(data.get(owner, { ...live, key: "p" }), "unpublished apps have no visitor data");
  await service.publish(owner, granted.id, granted.version);
  const secret = "synthetic-project-secret-zoom-42";
  await data.set(foreign, { ...live, key: "projects/a", value: { secret, list: [1, 2] } });
  await data.set(owner, { ...live, key: "projects/a", value: "owner copy" });
  assert.deepEqual((await data.get(foreign, { ...live, key: "projects/a" })).value, {
    secret,
    list: [1, 2],
  });
  assert.equal((await data.get(owner, { ...live, key: "projects/a" })).value, "owner copy");
  assert.deepEqual((await data.get(owner, { ...draftTarget, key: "p" })).value, { draft: true });
  assert.equal((await data.get(owner, { ...live, key: "p" })).found, false);
  assert.equal((await data.get(crossSpace, { ...live, key: "projects/a" })).found, false);
  await data.set(foreign, { ...live, key: "projects/b_x", value: null });
  assert.deepEqual(
    (await data.list(foreign, { ...live, prefix: "projects/b_" })).entries.map((e) => e.key),
    ["projects/b_x"],
  );
  assert.deepEqual(await data.get(foreign, { ...live, key: "projects/b_x" }), {
    found: true,
    value: null,
  });
  const raw = await asSystem(prisma, "inspect sealed app data").$queryRaw<
    Array<{ value: unknown }>
  >`SELECT value FROM hosted_web_data`;
  assert.ok(raw.length >= 4 && !JSON.stringify(raw).includes(secret));
  assert.equal(
    await runAsTenant(owner, () =>
      prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM hosted_web_data WHERE "userId"=${foreign.userId}`,
    ).then((rows) => rows[0]!.n),
    0,
    "RLS hides other users' app data even from the app owner",
  );
  const big = "x".repeat(900 * 1024);
  for (let i = 0; i < 5; i++) await data.set(foreign, { ...live, key: `big/${i}`, value: big });
  await assert.rejects(data.set(foreign, { ...live, key: "big/5", value: big }), /5 MB/);
  await data.set(foreign, { ...live, key: "big/0", value: "small" });
  await assert.rejects(data.set(foreign, { ...live, key: "huge", value: "x".repeat(1024 * 1024 + 1) }), /1 MB/);
  const revoked = await service.save(owner, { ...granted, version: granted.version, bundle });
  await service.publish(owner, revoked.id, revoked.version);
  await assert.rejects(data.get(foreign, { ...live, key: "projects/a" }), /permiso/);
  await system.hostedWeb.delete({ where: { id: storageApp.id } });
  assert.equal(
    await system.hostedWebData.count({ where: { siteId: storageApp.id } }),
    0,
  );
  checks.push(
    "app data requires the storage capability on the exact draft/published revision, is scoped per user/Space and preview, sealed at rest, hidden by RLS, quota-bound and deleted with the app",
  );
  // Draft history: every saved version is kept, restorable, private and bounded.
  const historyId = randomUUID();
  const page = (text: string) => ({
    files: [{ path: "index.html", base64: Buffer.from(`<h1>${text}</h1>`).toString("base64") }],
  });
  let current = await service.save(owner, {
    id: historyId,
    version: 0,
    slug: "history-test",
    title: "History v1",
    summary: "",
    bundle: page("history-secret-v1"),
  });
  current = await service.save(owner, { ...current, title: "History v2", bundle: page("v2") });
  const unchanged = await service.save(owner, { ...current, bundle: page("v2") });
  let history = await service.history(owner, historyId);
  assert.deepEqual(
    history.map((row) => [row.version, row.title, row.current]),
    [[2, "History v2", false], [1, "History v1", false]],
    "an unchanged save adds no snapshot",
  );
  assert.equal(unchanged.version, 3);
  await assert.rejects(service.history(foreign, historyId));
  await assert.rejects(service.restore(foreign, historyId, history[1]!.id, unchanged.version));
  await assert.rejects(service.restore(owner, historyId, history[1]!.id, 1), /changed/);
  const restored = await service.restore(owner, historyId, history[1]!.id, unchanged.version);
  assert.equal(restored.title, "History v1");
  assert.match(Buffer.from(restored.bundle.files[0]!.base64, "base64").toString(), /history-secret-v1/);
  history = await service.history(owner, historyId);
  assert.deepEqual(history[0], { ...history[0]!, version: 4, source: "restore", current: true });
  const sealed = await asSystem(prisma, "inspect sealed draft history").$queryRaw<
    Array<{ bundle: unknown }>
  >`SELECT bundle FROM hosted_web_snapshots WHERE "siteId"=${historyId}`;
  assert.ok(sealed.length === 3 && !JSON.stringify(sealed).includes(page("history-secret-v1").files[0]!.base64));
  await assert.rejects(
    asSystem(prisma, "try to mutate a snapshot").hostedWebSnapshot.updateMany({
      where: { siteId: historyId },
      data: { title: "mutated" },
    }),
  );
  for (let i = 0; i < 52; i++) current = await service.save(owner, { ...(await service.draft(owner, historyId)), bundle: page(`bulk-${i}`) });
  history = await service.history(owner, historyId);
  assert.equal(history.length, 50, "history keeps the newest 50 snapshots");
  assert.equal(history[0]!.current, true);
  await system.hostedWeb.delete({ where: { id: historyId } });
  assert.equal(await system.hostedWebSnapshot.count({ where: { siteId: historyId } }), 0);
  checks.push(
    "each saved draft version (manual, Mico, restore) is snapshotted encrypted and immutable; unchanged saves are skipped; restore is CAS-guarded, owner-only and never publishes; history keeps the newest 50 and is deleted with the app",
  );
  // Large app files: off by default, never on local disk, scoped, bounded, cleaned up.
  const objects = new Map<string, { spaceId: string; bytes: Uint8Array }>();
  const objectStore = {
    describe: () => ({ id: "object-artifacts", contractVersion: "1", adapterVersion: "test", capabilities: { stream: true } }),
    put: async (artifact: { bytes: Uint8Array }, ctx: { spaceId: string }) => {
      const key = `object:${randomUUID()}`;
      objects.set(key, { spaceId: ctx.spaceId, bytes: artifact.bytes });
      return { id: key, hash: "" };
    },
    get: async (key: string, ctx: { spaceId: string }) => {
      const row = objects.get(key);
      if (!row || row.spaceId !== ctx.spaceId) throw new Error("missing object");
      return row.bytes;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
  const localStore = { ...objectStore, describe: () => ({ ...objectStore.describe(), id: "local-artifacts" }) };
  assert.equal(hostedWebFilesConfig({}, objectStore).available, false, "off by default");
  assert.equal(
    hostedWebFilesConfig({ MYCELLIOS_HOSTED_WEB_FILES_ENABLED: "true" }, localStore).available,
    false,
    "never on the server's local disk",
  );
  const tight = {
    ...hostedWebFilesConfig({ MYCELLIOS_HOSTED_WEB_FILES_ENABLED: "true", MYCELLIOS_HOSTED_WEB_FILES_QUOTA_MB: "1", MYCELLIOS_HOSTED_WEB_FILE_MAX_MB: "9999" }, objectStore, 1024 * 1024),
    files: 3,
  };
  assert.ok(tight.available && tight.quotaBytes === 1024 * 1024 && tight.fileBytes === 1024 * 1024);
  const filesApp = await service.save(owner, {
    id: randomUUID(), version: 0, slug: "files-test", title: "Files test", summary: "", bundle,
  });
  await assert.rejects(
    service.save(owner, { ...filesApp, bundle: { ...bundle, capabilities: ["files"] } }),
    /no está disponible/,
    "a new files grant needs the operator switch",
  );
  const enabledService = hostedWebService(prisma, { filesAvailable: true });
  const filesDraft = await enabledService.save(owner, { ...filesApp, bundle: { ...bundle, capabilities: ["files"] } });
  await service.save(owner, { ...filesDraft, title: "Kept grant" });
  const fileTarget = { id: filesApp.id, preview: false };
  const off = hostedWebFilesService(prisma, objectStore as never, hostedWebFilesConfig({}, objectStore));
  const filesSvc = hostedWebFilesService(prisma, objectStore as never, tight);
  const b64 = (text: string) => Buffer.from(text).toString("base64");
  await assert.rejects(
    off.put(foreign, { ...fileTarget, name: "a.txt", mimeType: "text/plain", contentBase64: b64("x") }),
    /no está disponible/,
  );
  assert.equal(objects.size, 0, "a refused upload stores nothing");
  await assert.rejects(
    filesSvc.put(foreign, { ...fileTarget, name: "a.txt", mimeType: "text/plain", contentBase64: b64("x") }),
    "unpublished apps accept no visitor files",
  );
  const pub = await service.draft(owner, filesApp.id);
  await service.publish(owner, filesApp.id, pub.version);
  await filesSvc.put(foreign, { ...fileTarget, name: "clips/a.mp4", mimeType: "video/mp4", contentBase64: b64("visitor-video") });
  await filesSvc.put(owner, { ...fileTarget, name: "clips/a.mp4", mimeType: "video/mp4", contentBase64: b64("owner-video") });
  assert.equal(Buffer.from((await filesSvc.get(foreign, { ...fileTarget, name: "clips/a.mp4" })).contentBase64, "base64").toString(), "visitor-video");
  assert.equal(Buffer.from((await off.get(owner, { ...fileTarget, name: "clips/a.mp4" })).contentBase64, "base64").toString(), "owner-video", "existing files stay readable when switched off");
  await assert.rejects(filesSvc.get(crossSpace, { ...fileTarget, name: "clips/a.mp4" }));
  await assert.rejects(
    filesSvc.put(foreign, { ...fileTarget, name: "big.bin", mimeType: "application/octet-stream", contentBase64: Buffer.alloc(1024 * 1024 + 1).toString("base64") }),
    /supera/,
  );
  await filesSvc.put(foreign, { ...fileTarget, name: "half.bin", mimeType: "application/octet-stream", contentBase64: Buffer.alloc(700 * 1024).toString("base64") });
  await assert.rejects(
    filesSvc.put(foreign, { ...fileTarget, name: "half2.bin", mimeType: "application/octet-stream", contentBase64: Buffer.alloc(400 * 1024).toString("base64") }),
    /MB de archivos/,
  );
  await filesSvc.put(foreign, { ...fileTarget, name: "c.txt", mimeType: "text/plain", contentBase64: b64("c") });
  await assert.rejects(
    filesSvc.put(foreign, { ...fileTarget, name: "d.txt", mimeType: "text/plain", contentBase64: b64("d") }),
    /máximo de archivos/,
  );
  const before = objects.size;
  await filesSvc.put(foreign, { ...fileTarget, name: "c.txt", mimeType: "text/plain", contentBase64: b64("c2") });
  await sweepHostedWebFiles(prisma, objectStore);
  assert.equal(objects.size, before, "a replaced file's old object is removed");
  assert.deepEqual((await filesSvc.list(foreign, fileTarget)).entries.map((e) => e.name), ["c.txt", "clips/a.mp4", "half.bin"]);
  await filesSvc.delete(foreign, { ...fileTarget, name: "half.bin" });
  await sweepHostedWebFiles(prisma, objectStore);
  assert.equal(objects.size, before - 1);
  assert.equal(
    await runAsTenant(foreign, () => prisma.hostedWebFileTombstone.count()),
    0,
    "tombstones are not readable from a tenant context",
  );
  const fileRows = await asSystem(prisma, "inspect file rows").hostedWebFile.findMany({ where: { siteId: filesApp.id } });
  assert.ok(fileRows.every((row) => row.storageKey.startsWith("object:") && /^[0-9a-f]{64}$/.test(row.sha256)));
  await system.hostedWeb.delete({ where: { id: filesApp.id } });
  assert.equal(await system.hostedWebFileTombstone.count(), 3, "app deletion queues every visitor's objects");
  assert.equal(await sweepHostedWebFiles(prisma, objectStore), 3);
  assert.equal(objects.size, 0);
  assert.equal(await system.hostedWebFileTombstone.count(), 0);
  checks.push(
    "app files are off by default and never use local disk; new grants need the operator switch; scoped per user/Space, size/quota/count bounded, refused uploads store nothing, replaced/deleted/cascaded objects are removed from storage",
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
