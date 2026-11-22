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

// Group leads and purposes, Mico requests to several teammates and send_to_group, against a
// fresh disposable loopback PostgreSQL cluster. Synthetic rows only: no production data,
// accounts, credentials or models; never point it at another database.
process.env.NODE_ENV = "test";
process.env.CONTENT_ENCRYPTION = "off";
const run = promisify(execFile);
const {
  createDb,
  asSystem,
  createGroupRepos,
  createThreadMessage,
  awaitingRepliesForThread,
  loadRunHistoryMessages,
  samePromptPeerRunIds,
  hideAwaitingReplies,
} = await import("@mycellios/db");
const { messageBot, returnBotMessageOutcome } = await import(
  "../packages/adapters/src/bot-messages.js"
);
const { sendToGroup, settleGroupRequestRun, reconcileBotRequestRecipients } = await import(
  "../packages/adapters/src/group-requests.js"
);
const { interruptAgent, listAgents } = await import("../packages/adapters/src/team-awareness.js");
const { resolveThreadTarget, sendThreadMessage, stopThreadRuns } = await import(
  "../apps/api/src/thread-target.js"
);

const freePort = async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
};
const port = await freePort();
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-mico-requests-"));
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
const migration =
  "packages/db/prisma/migrations/20261123090000_mico_requests_and_group_leads/migration.sql";
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
const prismaEnv = (url: string) => ({
  ...process.env,
  DATABASE_URL: url,
  DATABASE_MIGRATION_URL: url,
});
try {
  await postgres.initialise();
  await postgres.start();
  const base = `postgresql://postgres:${password}@127.0.0.1:${port}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query("CREATE DATABASE legacy");
  await admin.end();

  // Remove only the objects owned by this migration from the disposable schema.
  const legacyUrl = `${base}/legacy`;
  await run(
    process.execPath,
    [prismaCli, "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: prismaEnv(legacyUrl), maxBuffer: 4 * 1024 * 1024 },
  );
  const legacy = new pg.Client({ connectionString: legacyUrl });
  await legacy.connect();
  await legacy.query(`
    DROP TABLE bot_message_recipients, bot_message_requests;
    ALTER TABLE chat_groups DROP COLUMN purpose, DROP COLUMN "leadBotId";
  `);
  await legacy.query(await readFile(migration, "utf8"));
  const policies = await legacy.query(
    `SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('bot_message_requests','bot_message_recipients') ORDER BY 1, 2`,
  );
  assert.deepEqual(
    policies.rows.map((row) => row.policyname),
    [
      "bot_message_recipients_system",
      "bot_message_recipients_tenant",
      "bot_message_requests_system",
      "bot_message_requests_tenant",
    ],
  );
  await assert.rejects(
    legacy.query(
      `INSERT INTO bot_message_recipients (id, "requestId", "spaceId", "userId", "botId", state) VALUES ('x','missing','s','u','b','maybe')`,
    ),
  );
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
    "the additive migration restores the expected schema with row-level security and a state CHECK",
  );

  const url = `${base}/postgres`;
  await run(
    process.execPath,
    [prismaCli, "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: prismaEnv(url), maxBuffer: 4 * 1024 * 1024 },
  );
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-mico-requests" });
  const prisma = asSystem(db.prisma, "isolated synthetic mico request acceptance");
  const scope = { spaceId: "space", userId: "owner" };
  const actor = { ...scope, role: "owner" } as never;
  await prisma.user.create({
    data: { id: scope.userId, name: "Synthetic owner", email: "owner@example.invalid" },
  });
  await prisma.organization.create({
    data: { id: "org", name: "Synthetic", slug: "mico-requests", createdAt: new Date() },
  });
  await prisma.space.create({
    data: { id: scope.spaceId, organizationId: "org", name: "Synthetic" },
  });
  await prisma.member.create({
    data: {
      id: "member",
      userId: scope.userId,
      organizationId: "org",
      role: "owner",
      createdAt: new Date(),
    },
  });
  await prisma.spaceMember.create({
    data: {
      id: "space-member",
      userId: scope.userId,
      organizationId: "org",
      spaceId: scope.spaceId,
      role: "owner",
      createdAt: new Date(),
    },
  });
  const mico = async (id: string, name: string) =>
    prisma.bot.create({
      data: { ...scope, id, name, color: "green", thread: { create: { ...scope } } },
      include: { thread: true },
    });
  const lead = await mico("lead", "Lead");
  const analyst = await mico("analyst", "Analyst");
  const writer = await mico("writer", "Writer");
  const scout = await mico("scout", "Scout");
  const notices: Array<[string, number]> = [];
  const queued: string[] = [];
  const cancelledJobs: string[] = [];
  const deps = {
    prisma,
    events: {
      notify: async (threadId: string, seq: number) => {
        notices.push([threadId, seq]);
      },
    },
    jobs: {
      enqueue: async (job: { key?: string; payload?: { runId?: string } }) => {
        queued.push(job.payload?.runId ?? job.key ?? "");
      },
      cancel: async (key: string) => {
        cancelledJobs.push(key);
      },
    },
  } as never;
  const lease = { leaseOwner: "synthetic-worker", leaseFence: 1 };
  const running = async (
    threadId: string,
    botId: string,
    trigger: string,
    sourceMessageId?: string,
  ) => {
    const task = await prisma.task.create({
      data: { ...scope, botId, threadId, prompt: "Synthetic", status: "running" },
    });
    return prisma.run.create({
      data: {
        ...scope,
        botId,
        threadId,
        taskId: task.id,
        status: "running",
        trigger,
        ...lease,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        startedAt: new Date(),
        sourceMessageId,
      },
    });
  };
  const start = (runId: string) =>
    prisma.run.update({
      where: { id: runId },
      data: {
        status: "running",
        ...lease,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        startedAt: new Date(),
      },
    });
  const reply = async (runRow: { id: string; threadId: string; botId: string }, text: string) => {
    await createThreadMessage(prisma, {
      threadId: runRow.threadId,
      role: "bot",
      botId: runRow.botId,
      runId: runRow.id,
      blocks: [{ kind: "text", text }],
    });
    await prisma.run.update({
      where: { id: runRow.id },
      data: { status: "completed", completedAt: new Date() },
    });
  };
  const sourceOf = (row: {
    id: string;
    threadId: string;
    botId: string;
    sourceMessageId?: string | null;
  }) => ({
    ...scope,
    id: row.id,
    threadId: row.threadId,
    botId: row.botId,
    sourceMessageId: row.sourceMessageId ?? null,
  });

  // 1. Groups keep a purpose and the lead the person chose; the lead must stay a member.
  const groups = createGroupRepos(prisma);
  const group = await groups.createGroup(actor, {
    name: "Launch",
    botIds: [analyst.id, lead.id, writer.id],
    purpose: "  Ship Q3  ",
    leadBotId: lead.id,
  });
  assert.deepEqual([group.purpose, group.leadBotId], ["Ship Q3", lead.id]);
  await assert.rejects(
    groups.createGroup(actor, {
      name: "Bad",
      botIds: [analyst.id, writer.id],
      leadBotId: scout.id,
    }),
  );
  await assert.rejects(groups.updateGroup(actor, { groupId: group.id, leadBotId: scout.id }));
  const withoutLead = await groups.updateGroup(actor, {
    groupId: group.id,
    botIds: [analyst.id, writer.id],
  });
  assert.equal(withoutLead.group.leadBotId, null);
  const restored = await groups.updateGroup(actor, {
    groupId: group.id,
    botIds: [analyst.id, lead.id, writer.id],
    leadBotId: lead.id,
    purpose: "",
  });
  assert.deepEqual([restored.group.leadBotId, restored.group.purpose], [lead.id, ""]);
  checks.push(
    "a group stores its purpose and chosen lead, refuses a non-member lead and falls back to the first member when the lead leaves",
  );

  // 2. A group message that names nobody goes to the lead only; a named member goes first.
  const target = await resolveThreadTarget(prisma, actor, { groupId: group.id });
  const sent = await sendThreadMessage(deps, actor, target, {
    text: "Draft the launch post",
    clientNonce: "send-1",
  });
  const routed = await prisma.run.findMany({
    where: { threadId: target.threadId, sourceMessageId: sent.messageId ?? undefined },
  });
  assert.deepEqual(
    routed.map((row) => row.botId),
    [lead.id],
  );
  const named = await sendThreadMessage(deps, actor, target, {
    text: "@Writer polish the tagline",
    clientNonce: "send-2",
  });
  assert.deepEqual(
    (await prisma.run.findMany({ where: { sourceMessageId: named.messageId ?? undefined } })).map(
      (row) => row.botId,
    ),
    [writer.id],
  );
  checks.push(
    "routing is deterministic: explicit mentions first, otherwise the chosen lead, with no extra model turn",
  );

  // 3. Members answer from their own view: a teammate's reply to the same message stays hidden.
  await prisma.run.updateMany({
    where: { threadId: target.threadId, status: { in: ["queued", "running"] } },
    data: { status: "completed" },
  });
  const everyone = await sendThreadMessage(deps, actor, target, {
    text: "@everyone status?",
    clientNonce: "send-3",
  });
  const [leadRun, analystRun] = await Promise.all(
    [lead.id, analyst.id].map((botId) =>
      prisma.run.findFirstOrThrow({
        where: { sourceMessageId: everyone.messageId ?? undefined, botId },
      }),
    ),
  );
  await start(leadRun!.id);
  await reply(leadRun!, "Lead's own status");
  await start(analystRun!.id);
  const hidden = await samePromptPeerRunIds(prisma, analystRun!);
  assert.ok(hidden.includes(leadRun!.id));
  const history = await loadRunHistoryMessages(prisma, analystRun!, 100, undefined, 0, hidden);
  assert.ok(!history.some((message) => message.runId === leadRun!.id));
  assert.ok(
    (await loadRunHistoryMessages(prisma, analystRun!, 100)).some(
      (message) => message.runId === leadRun!.id,
    ),
  );
  await reply(analystRun!, "Analyst status");
  checks.push(
    "a member's history leaves out other members' replies to the same message until it has answered",
  );

  // 4. "continue" resumes the members whose work on the newest request stopped, nobody else.
  await prisma.run.updateMany({
    where: { threadId: target.threadId, status: { in: ["queued", "running"] } },
    data: { status: "completed" },
  });
  const request = await sendThreadMessage(deps, actor, target, {
    text: "@Analyst @Writer write the FAQ",
    clientNonce: "send-4",
  });
  const faqRuns = await prisma.run.findMany({
    where: { sourceMessageId: request.messageId ?? undefined },
  });
  const faqWriter = faqRuns.find((row) => row.botId === writer.id)!;
  await prisma.run.update({
    where: { id: faqRuns.find((row) => row.botId === analyst.id)!.id },
    data: { status: "completed" },
  });
  await stopThreadRuns(
    deps,
    actor,
    await resolveThreadTarget(prisma, actor, { groupId: group.id }),
    [faqWriter.id],
  );
  const resumed = await sendThreadMessage(deps, actor, target, {
    text: "keep going",
    clientNonce: "send-5",
  });
  const continueRuns = await prisma.run.findMany({
    where: { sourceMessageId: resumed.messageId ?? undefined },
    include: { task: true },
  });
  assert.deepEqual(
    continueRuns.map((row) => row.botId),
    [writer.id],
  );
  assert.match(
    continueRuns[0]!.task.prompt,
    /<earlier_request>\n@Analyst @Writer write the FAQ\n<\/earlier_request>/,
  );
  assert.match(continueRuns[0]!.task.prompt, /do not start over/);
  checks.push(
    '"keep going" in a group continues only the stopped member\'s work on the newest request',
  );

  // 5. One message to two teammates: both answers come back together in one turn.
  const leadMain = lead.thread!.id;
  const ask = await running(leadMain, lead.id, "user");
  const asked = await messageBot(
    deps,
    sourceOf(ask),
    { id: lead.id, name: lead.name },
    { bot_ids: [analyst.id, writer.id], message: "Check the numbers", deliveryKey: "ask-1" },
  );
  assert.equal(asked.ok, true);
  const requestRow = await prisma.botMessageRequest.findFirstOrThrow({
    where: { senderRunId: ask.id },
    include: { recipients: { include: { run: true } } },
  });
  assert.deepEqual(
    requestRow.recipients.map((row) => [row.botId, row.state, row.run?.status]),
    [
      [analyst.id, "asked", "queued"],
      [writer.id, "asked", "queued"],
    ],
  );
  const replayed = await messageBot(
    deps,
    sourceOf(ask),
    { id: lead.id, name: lead.name },
    { bot_ids: [analyst.id, writer.id], message: "Check the numbers", deliveryKey: "ask-1" },
  );
  assert.equal("replayed" in replayed && replayed.replayed, true);
  assert.equal(await prisma.botMessageRequest.count({ where: { senderRunId: ask.id } }), 1);
  await prisma.run.update({ where: { id: ask.id }, data: { status: "completed" } });
  let list = await awaitingRepliesForThread(prisma, {
    ...scope,
    botId: lead.id,
    threadId: leadMain,
  });
  assert.deepEqual(
    list.requests[0]?.recipients.map((row) => row.state),
    ["asked", "asked"],
  );
  const analystAnswerRun = requestRow.recipients[0]!.run!;
  await start(analystAnswerRun.id);
  await reply(analystAnswerRun, "Status: done\nResult: numbers match");
  const before = await prisma.run.count({ where: { threadId: leadMain } });
  assert.equal(
    await returnBotMessageOutcome(
      deps,
      analystAnswerRun,
      { id: analyst.id, name: analyst.name },
      "Status: done\nResult: numbers match",
      "result",
    ),
    true,
  );
  assert.equal(await prisma.run.count({ where: { threadId: leadMain } }), before);
  list = await awaitingRepliesForThread(prisma, { ...scope, botId: lead.id, threadId: leadMain });
  assert.deepEqual(
    list.requests[0]?.recipients.map((row) => row.state),
    ["replied", "asked"],
  );
  const held = await prisma.message.findFirstOrThrow({
    where: { threadId: leadMain, role: "user" },
    orderBy: { seq: "desc" },
  });
  assert.equal(held.runId, null);
  checks.push(
    "a message reaches up to 32 teammates as one request, replays once, and holds the first answer without starting a turn",
  );

  // 6. The person stops the other teammate from the list: the request settles and the sender
  //    resumes once, with the answer it has and the name of who did not answer.
  const writerTarget = await resolveThreadTarget(prisma, actor, { botId: writer.id });
  await stopThreadRuns(deps, actor, writerTarget, [requestRow.recipients[1]!.runId!]);
  const settledRequest = await prisma.botMessageRequest.findUniqueOrThrow({
    where: { id: requestRow.id },
    include: { recipients: true },
  });
  assert.ok(settledRequest.settledAt && settledRequest.resumeRunId);
  assert.deepEqual(
    settledRequest.recipients.map((row) => row.state),
    ["replied", "stopped"],
  );
  const resume = await prisma.run.findUniqueOrThrow({
    where: { id: settledRequest.resumeRunId! },
    include: { task: true },
  });
  assert.deepEqual(
    [resume.threadId, resume.botId, resume.trigger, resume.status],
    [leadMain, lead.id, "bot_message", "queued"],
  );
  assert.match(resume.task.prompt, /1 of 2 answered/);
  assert.match(resume.task.prompt, /numbers match/);
  assert.match(resume.task.prompt, /No answer came from: Writer/);
  assert.ok(queued.includes(resume.id));
  assert.equal(
    (await prisma.message.findUniqueOrThrow({ where: { id: held.id } })).runId,
    resume.id,
  );
  list = await awaitingRepliesForThread(prisma, { ...scope, botId: lead.id, threadId: leadMain });
  assert.equal(list.requests[0]?.settled, true);
  await hideAwaitingReplies(prisma, scope, [requestRow.id]);
  assert.equal(
    (await awaitingRepliesForThread(prisma, { ...scope, botId: lead.id, threadId: leadMain }))
      .requests.length,
    0,
  );
  checks.push(
    "stopping the last recipient settles the request and queues one resume turn naming who did not answer; Hide this list hides it",
  );

  // 7. Every recipient stopped: no answer, no turn.
  const ask2 = await running(leadMain, lead.id, "user");
  await messageBot(
    deps,
    sourceOf(ask2),
    { id: lead.id, name: lead.name },
    { bot_ids: [scout.id, writer.id], message: "Anyone free?", deliveryKey: "ask-2" },
  );
  const request2 = await prisma.botMessageRequest.findFirstOrThrow({
    where: { senderRunId: ask2.id },
    include: { recipients: true },
  });
  await prisma.run.updateMany({
    where: { id: { in: request2.recipients.map((row) => row.runId!) } },
    data: { status: "cancelled", updatedAt: new Date(Date.now() - 60_000) },
  });
  await prisma.botMessageRecipient.updateMany({
    where: { requestId: request2.id },
    data: { createdAt: new Date(Date.now() - 60_000) },
  });
  await reconcileBotRequestRecipients(deps);
  const settled2 = await prisma.botMessageRequest.findUniqueOrThrow({
    where: { id: request2.id },
    include: { recipients: true },
  });
  assert.ok(settled2.settledAt);
  assert.equal(settled2.resumeRunId, null);
  assert.deepEqual(
    settled2.recipients.map((row) => row.state),
    ["stopped", "stopped"],
  );
  checks.push(
    "the reconciler settles recipients stopped elsewhere, and a request nobody answered starts no turn",
  );

  // 8. send_to_group from a member's own chat: the lead takes it and its result returns to that chat.
  const analystMain = analyst.thread!.id;
  const brief = await running(analystMain, analyst.id, "user");
  const handed = await sendToGroup(
    deps,
    sourceOf(brief),
    { id: analyst.id, name: analyst.name },
    { group_id: group.id, message: "Collect the launch risks", deliveryKey: "brief-1" },
  );
  assert.equal("ok" in handed && handed.ok, true);
  const groupRun = await prisma.run.findFirstOrThrow({
    where: { threadId: target.threadId, botMessageRecipient: { isNot: null } },
    include: { botMessageRecipient: { include: { request: true } } },
  });
  assert.deepEqual(
    [groupRun.botId, groupRun.trigger, groupRun.botMessageRecipient?.request.groupId],
    [lead.id, "follow_up", group.id],
  );
  await prisma.run.update({ where: { id: brief.id }, data: { status: "completed" } });
  await start(groupRun.id);
  await reply(groupRun, "Risks: supplier delay, translation");
  await settleGroupRequestRun(deps, groupRun.id);
  const groupRequest = await prisma.botMessageRequest.findUniqueOrThrow({
    where: { id: groupRun.botMessageRecipient!.requestId },
  });
  const back = await prisma.run.findUniqueOrThrow({
    where: { id: groupRequest.resumeRunId! },
    include: { task: true, sourceMessage: true },
  });
  assert.deepEqual(
    [back.threadId, back.botId, back.trigger],
    [analystMain, analyst.id, "bot_message"],
  );
  assert.match(back.task.prompt, /supplier delay/);
  assert.equal(
    ((back.sourceMessage?.blocks ?? []) as Array<{ kind: string; fromBotId?: string }>)[0]
      ?.fromBotId,
    lead.id,
  );
  await settleGroupRequestRun(deps, groupRun.id);
  assert.equal(
    await prisma.run.count({
      where: { threadId: analystMain, trigger: "bot_message", createdAt: { gte: brief.createdAt } },
    }),
    1,
  );
  checks.push(
    "send_to_group starts the lead in the group and returns its result once to the sender's main chat",
  );

  // 9. interrupt_agent stops only work the caller sent, through the durable Stop.
  const ask3 = await running(leadMain, lead.id, "user");
  await messageBot(
    deps,
    sourceOf(ask3),
    { id: lead.id, name: lead.name },
    { bot_id: scout.id, message: "Scan the logs", deliveryKey: "ask-3" },
  );
  const scoutRun = await prisma.run.findFirstOrThrow({
    where: { botId: scout.id, status: "queued", trigger: "bot_message" },
  });
  await start(scoutRun.id);
  const personRun = await running(writer.thread!.id, writer.id, "user");
  const refused = await interruptAgent(
    deps,
    { ...scope, botId: lead.id, name: lead.name },
    { bot_id: writer.id, reason: "Not needed" },
  );
  assert.match(String((refused as { error?: string }).error), /Only the person can stop that/);
  assert.equal(
    (await prisma.run.findUniqueOrThrow({ where: { id: personRun.id } })).status,
    "running",
  );
  const stopped = await interruptAgent(
    deps,
    { ...scope, botId: lead.id, name: lead.name },
    { bot_id: scout.id, reason: "The logs were already scanned" },
  );
  assert.equal((stopped as { ok?: boolean }).ok, true);
  const scoutAfter = await prisma.run.findUniqueOrThrow({
    where: { id: scoutRun.id },
    include: { task: true, botMessageRecipient: true },
  });
  assert.deepEqual(
    [scoutAfter.status, scoutAfter.task.workStopPending, scoutAfter.botMessageRecipient?.state],
    ["cancelled", true, "stopped"],
  );
  const notice = await prisma.message.findFirstOrThrow({
    where: { threadId: scout.thread!.id },
    orderBy: { seq: "desc" },
  });
  assert.match(JSON.stringify(notice.blocks), /already scanned/);
  assert.equal(notice.runId, null);
  checks.push(
    "interrupt_agent stops a teammate's work on the caller's own message, tells it why, and refuses a turn the person started",
  );

  // 10. list_agents shows what each teammate is doing.
  const listed = await listAgents(deps, { ...scope, botId: lead.id });
  const writerStatus = listed.agents.find((agent) => agent.id === writer.id)!;
  assert.equal(writerStatus.status, "working");
  assert.ok(writerStatus.turnStartedAt);
  assert.ok(!listed.agents.some((agent) => agent.id === lead.id));
  checks.push(
    "list_agents reports each teammate's status, turn start and activity, never the caller itself",
  );

  const result = { passed: true, checks, productionAccess: false };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, receipt: path.join(directory, "result.json") }, null, 2));
} finally {
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
