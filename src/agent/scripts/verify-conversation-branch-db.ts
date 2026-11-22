// Qualifies "Branch in new conversation" (specs/conversation-branching) on a fresh, disposable
// loopback PostgreSQL with content encryption on and a real local artifact store.
// Synthetic data only: no production database, accounts, credentials or models.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MessageBlock } from "@mycellios/contracts";
import EmbeddedPostgres from "embedded-postgres";

process.env.NODE_ENV = "test";
const { asSystem, createDb, createThreadMessageInTransaction, LocalKeyProvider, resolveNextArtifactVersion, runAsTenant } =
  await import("@mycellios/db");
const { BRANCH_TITLE_FALLBACK } = await import("@mycellios/core");
const { developmentRoutes } = await import("../apps/api/src/routes/development.js");
const { createArtifactStore } = await import("../packages/adapters/src/artifact-store-factory.js");
const { purgeDeletedThread } = await import("../packages/adapters/src/thread-deletion.js");

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-conversation-branch-"));
const dataDir = path.join(directory, "data");
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true, initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}, onError: () => {} });
let db: ReturnType<typeof createDb> | undefined;
const checks: string[] = [];
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  db = createDb(url, { encryptContent: true, keyProvider: new LocalKeyProvider([{ id: "synthetic", key: randomBytes(32) }]),
    applicationName: "synthetic-conversation-branch" });
  const prisma = db.prisma, system = asSystem(prisma, "synthetic conversation branch fixtures");
  const sql = await db.pool.connect();
  const rows = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await sql.query(text, values)).rows as T[];
  try {
    assert.match((await sql.query("SHOW listen_addresses")).rows[0].listen_addresses, /^(localhost|127\.0\.0\.1|::1)$/);
    const owner = { userId: "owner", spaceId: "space", organizationId: "org", email: "owner@example.invalid", isDeploymentOwner: false };
    const other = { ...owner, userId: "other", email: "other@example.invalid" };
    const elsewhere = { ...owner, spaceId: "space-b" };
    await system.organization.create({ data: { id: "org", name: "Synthetic", slug: "conversation-branch", createdAt: new Date() } });
    for (const id of ["space", "space-b"]) await system.space.create({ data: { id, organizationId: "org", name: id } });
    for (const user of [owner, other]) {
      await system.user.create({ data: { id: user.userId, name: user.userId, email: user.email } });
      await system.member.create({ data: { id: `member-${user.userId}`, userId: user.userId, organizationId: "org", role: "member", createdAt: new Date() } });
      for (const spaceId of ["space", "space-b"])
        await system.spaceMember.create({ data: { id: `sm-${user.userId}-${spaceId}`, userId: user.userId, organizationId: "org", spaceId, role: "member", createdAt: new Date() } });
    }
    const makeBot = async (id: string, userId: string, spaceId: string) => (await system.bot.create({
      data: { id, spaceId, userId, name: id, color: "#10B981", thread: { create: { spaceId, userId } } }, include: { thread: true } })).thread!.id;
    const main = await makeBot("mico", "owner", "space");
    await makeBot("mico-two", "owner", "space");
    await makeBot("foreign", "other", "space");
    await makeBot("mico-b", "owner", "space-b");

    const store = createArtifactStore(dataDir, prisma, {});
    const storeContext = { operationId: "fixture", traceId: "fixture", spaceId: "space", userId: "owner", botId: "mico", signal: new AbortController().signal };
    const upload = async (name: string, mimeType: string, text: string, runId: string | null) => {
      const bytes = new TextEncoder().encode(text);
      const stored = await store.put({ name, mimeType, bytes }, storeContext);
      return system.artifact.create({ data: { spaceId: "space", userId: "owner", botId: "mico", runId, name, mimeType, size: bytes.byteLength,
        hash: `sha-${name}`, storageKey: stored.id } });
    };
    const readBytes = async (storageKey: string) => new TextDecoder().decode(await store.get(storageKey, storeContext));
    const write = (threadId: string, input: { role: "user" | "bot" | "system"; blocks: MessageBlock[]; runId?: string; clientNonce?: string; replyToMessageId?: string }) =>
      runAsTenant(owner, () => prisma.$transaction((tx) => createThreadMessageInTransaction(tx, { threadId, botId: input.role === "user" ? undefined : "mico", ...input })));
    const turn = async (threadId: string, status = "completed", trigger = "user") => {
      const task = await system.task.create({ data: { spaceId: "space", botId: "mico", threadId, userId: "owner", prompt: "Synthetic", status } });
      return system.run.create({ data: { spaceId: "space", botId: "mico", threadId, taskId: task.id, userId: "owner", status, trigger } });
    };
    const text = (value: string): MessageBlock[] => [{ kind: "text", text: value }];

    // The main chat: two finished turns with a progress note, files, a reaction, a pin, usage,
    // an effect, a hidden background step and a queued message, then a third turn.
    const firstRun = await turn(main);
    const question = await write(main, { role: "user", blocks: text("Plan the spring trip\nWith trains"), runId: firstRun.id });
    await write(main, { role: "bot", blocks: text("Looking at trains first."), runId: firstRun.id, clientNonce: `user-progress:${firstRun.id}:1` });
    const report = await upload("itinerary.pdf", "application/pdf", "synthetic itinerary bytes", firstRun.id);
    const photo = await upload("station.png", "image/png", "synthetic photo bytes", null);
    const answer = await write(main, { role: "bot", runId: firstRun.id, blocks: [
      { kind: "text", text: "Here is the plan." },
      { kind: "file", artifactId: report.id, mimeType: "application/pdf", name: "itinerary.pdf", size: report.size },
      { kind: "image", artifactId: photo.id, mimeType: "image/png", name: "station.png" },
    ] });
    await write(main, { role: "user", blocks: text("👍"), replyToMessageId: answer.id });
    await system.messagePin.create({ data: { messageId: answer.id, threadId: main, spaceId: "space", userId: "owner" } });
    await system.usageRecord.create({ data: { spaceId: "space", userId: "owner", botId: "mico", runId: firstRun.id, provider: "synthetic", model: "synthetic", costUsd: 0.5 } });
    await system.externalEffect.create({ data: { spaceId: "space", runId: firstRun.id, kind: "synthetic", idempotencyKey: randomUUID(), status: "completed", request: {} } });
    const secondRun = await turn(main);
    const followUp = await write(main, { role: "user", blocks: text("And the hotels?"), runId: secondRun.id, replyToMessageId: answer.id });
    const background = await turn(main, "completed", "tickets");
    await write(main, { role: "bot", blocks: text("Background ticket chatter"), runId: background.id });
    const queued = await write(main, { role: "user", blocks: text("Queued for later") });
    await system.steeringMessage.create({ data: { messageId: queued.id, botId: "mico", userId: "owner", originTrigger: "queued_user" } });
    const hotels = await write(main, { role: "bot", blocks: text("Two hotels near the station."), runId: secondRun.id });
    const thirdRun = await turn(main);
    await write(main, { role: "user", blocks: text("Book the first one"), runId: thirdRun.id });
    await write(main, { role: "bot", blocks: text("Booked."), runId: thirdRun.id });

    const handler = { handler: (fn: unknown) => fn };
    const anyRoute = new Proxy({}, { get: () => new Proxy({}, { get: () => handler }) });
    const dev = developmentRoutes({ deps: { prisma, artifacts: store }, authed: anyRoute } as never).development as unknown as
      Record<string, (input: unknown) => Promise<any>>;
    const call = (name: string, input: object, actor: typeof owner = owner) =>
      runAsTenant(actor, () => dev[name]!({ context: { actor }, input }));
    const branch = (input: object, actor: typeof owner = owner) =>
      call("branch", { botId: "mico", requestId: randomUUID(), ...input }, actor);
    const blobCount = async () => (await rows<{ count: string }>(`SELECT count(*) FROM artifacts`))[0]!.count;

    // 1. A branch of the main chat at the end of its second turn.
    const requestId = randomUUID();
    const made = await branch({ messageId: hotels.id, requestId });
    assert.equal(made.replayed, false);
    assert.equal(made.title, "And the hotels?");
    const thread = await system.thread.findUniqueOrThrow({ where: { id: made.threadId } });
    assert.deepEqual([thread.taskBotId, thread.startedBy, thread.titleSource, thread.branchedFromThreadId, thread.branchedFromMessageId, thread.botId],
      ["mico", "branch", "auto", main, hotels.id, null]);
    assert.equal(thread.taskKey, `mico-task:mico:branch:${requestId}`);
    const copied = await runAsTenant(owner, () => prisma.message.findMany({ where: { threadId: made.threadId }, orderBy: { seq: "asc" } }));
    const texts = copied.map((message) => (message.blocks as MessageBlock[]).map((block) => block.kind === "text" ? block.text : block.kind).join("|"));
    assert.deepEqual(texts, ["Plan the spring trip\nWith trains", "Looking at trains first.", "Here is the plan.|file|image", "And the hotels?",
      "Two hotels near the station.", "branch_origin"]);
    assert.deepEqual(copied.map((message) => message.seq), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual([thread.nextMessageSeq, thread.lastReadSeq, thread.unread], [6, 5, false]);
    const sourceIds = new Set((await system.message.findMany({ where: { threadId: main }, select: { id: true } })).map((row) => row.id));
    assert.ok(copied.every((message) => !sourceIds.has(message.id) && message.runId === null));
    assert.equal(copied[3]!.replyToMessageId, copied[2]!.id);
    assert.match(copied[1]!.clientNonce ?? "", /^user-progress:branch:/);
    assert.ok([0, 2, 3, 4].every((index) => copied[index]!.clientNonce === null));
    const origin = (copied[5]!.blocks as MessageBlock[])[0] as Extract<MessageBlock, { kind: "branch_origin" }>;
    assert.deepEqual([copied[5]!.role, origin.threadId, origin.messageId, origin.main], ["system", main, hotels.id, true]);
    checks.push("a main-chat branch copies the turns up to the end of the chosen one with new ids and sequence, keeps replies and progress notes, and ends with a divider naming its source");
    assert.ok(!texts.some((value) => value === "👍" || value.includes("Background") || value.includes("Queued") || value.includes("Booked")));
    assert.equal(await system.run.count({ where: { threadId: made.threadId } }), 0);
    assert.equal(await system.event.count({ where: { threadId: made.threadId } }), 0);
    assert.equal(await system.messagePin.count({ where: { threadId: made.threadId } }), 0);
    assert.equal(await system.steeringMessage.count({ where: { message: { threadId: made.threadId } } }), 0);
    assert.equal(await system.usageRecord.count(), 1);
    assert.equal(await system.externalEffect.count(), 1);
    assert.equal(await system.inboxTask.count({ where: { threadId: made.threadId } }), 0);
    checks.push("reactions, pins, read marks, queued messages, hidden background steps, later turns, runs, usage, costs, effects and events are never copied");

    const copiedFile = (copied[2]!.blocks as MessageBlock[]).find((block) => block.kind === "file") as Extract<MessageBlock, { kind: "file" }>;
    const copiedImage = (copied[2]!.blocks as MessageBlock[]).find((block) => block.kind === "image") as Extract<MessageBlock, { kind: "image" }>;
    assert.ok(copiedFile.artifactId !== report.id && copiedImage.artifactId !== photo.id);
    const copies = await system.artifact.findMany({ where: { id: { in: [copiedFile.artifactId, copiedImage.artifactId] } }, orderBy: { name: "asc" } });
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      const original = copy.name === report.name ? report : photo;
      assert.deepEqual([copy.spaceId, copy.userId, copy.botId, copy.runId, copy.mimeType, copy.size, copy.version, copy.rootArtifactId],
        ["space", "owner", "mico", null, original.mimeType, original.size, 1, null]);
      assert.notEqual(copy.storageKey, original.storageKey);
      assert.equal(copy.clientNonce, `branch-copy:${made.threadId}:${original.id}`);
      assert.equal(await readBytes(copy.storageKey), await readBytes(original.storageKey));
    }
    const nextVersion = await resolveNextArtifactVersion(system, { spaceId: "space", userId: "owner", botId: "mico", name: "itinerary.pdf" });
    assert.deepEqual(nextVersion, { rootArtifactId: report.id, version: 2 });
    checks.push("files the copied messages show are copied as new artifacts and storage objects of the same owner, Space and Mico; new versions keep building on the originals");

    const raw = await rows<{ blocks: string; searchTokens: number[] | null }>(`SELECT blocks::text AS blocks, "searchTokens" FROM messages WHERE "threadId" = $1 ORDER BY seq`, [made.threadId]);
    assert.ok(raw.every((row) => row.blocks.includes("$sealed")));
    assert.ok(!raw.some((row) => row.blocks.includes("spring trip") || row.blocks.includes("hotels")));
    assert.ok((raw[0]!.searchTokens ?? []).length > 0);
    const found = await runAsTenant(owner, () => prisma.message.findFirstOrThrow({ where: { id: copied[0]!.id } }));
    assert.equal((found.blocks as Array<{ text: string }>)[0]!.text, "Plan the spring trip\nWith trains");
    checks.push("copied content stays encrypted at rest under the owner's Space key, bound to its new rows, and still decrypts and indexes for search");

    // 2. Idempotency: the same request id returns the same branch, even when two race.
    const before = await blobCount();
    assert.deepEqual(await branch({ messageId: hotels.id, requestId }), { ...made, replayed: true });
    assert.equal(await blobCount(), before);
    const raced = randomUUID();
    const pair = await Promise.all([branch({ messageId: answer.id, requestId: raced }), branch({ messageId: answer.id, requestId: raced })]);
    assert.equal(pair[0].threadId, pair[1].threadId);
    assert.equal(await system.thread.count({ where: { taskKey: `mico-task:mico:branch:${raced}` } }), 1);
    const racedMessages = await system.message.count({ where: { threadId: pair[0].threadId } });
    assert.equal(racedMessages, 4);
    assert.equal(await system.artifact.count({ where: { clientNonce: { startsWith: `branch-copy:${pair[0].threadId}:` } } }), 2);
    checks.push("a retry with the same request id returns the same branch without copying again, also when two requests race");

    // 3. Refusals: a running turn, a message that ends no Mico turn, and other owners, Spaces or Micos.
    const running = await turn(main, "running");
    await assert.rejects(branch({ messageId: hotels.id }), /still working on a turn/);
    await system.run.update({ where: { id: running.id }, data: { status: "completed" } });
    await assert.rejects(branch({ messageId: followUp.id }), /Mico reply of a finished turn/);
    await assert.rejects(branch({ messageId: question.id }), /Mico reply of a finished turn/);
    const threadsBefore = await system.thread.count();
    await assert.rejects(branch({ messageId: hotels.id }, other));
    await assert.rejects(branch({ messageId: hotels.id }, elsewhere));
    await assert.rejects(call("branch", { botId: "foreign", messageId: hotels.id, requestId: randomUUID() }), /not found|Mico reply/i);
    await assert.rejects(call("branch", { botId: "mico-two", messageId: hotels.id, requestId: randomUUID() }), /Mico reply of a finished turn/);
    await assert.rejects(call("branch", { botId: "mico-two", taskThreadId: made.threadId, messageId: hotels.id, requestId: randomUUID() }), /not found/);
    assert.equal(await system.thread.count(), threadsBefore);
    checks.push("refused while a turn runs, from a person's message, and for another person, another Space or another Mico, with nothing created");

    // 4. A side conversation: "{title} #N" counting up, branches of branches and the compacted summary.
    const side = (await call("open", { botId: "mico", projectKey: "mico:mico", taskKey: `mico-task:mico:${randomUUID()}`, title: "Trip budget" })).threadId as string;
    const sideRun = await turn(side);
    const sideAsk = await write(side, { role: "user", blocks: text("Estimate the budget"), runId: sideRun.id });
    const sideAnswer = await write(side, { role: "bot", blocks: text("About 900 euros."), runId: sideRun.id });
    await sql.query(`UPDATE threads SET "historyCompactedUpToSeq" = $2 WHERE id = $1`, [side, sideAsk.seq]);
    await runAsTenant(owner, () => prisma.thread.update({ where: { id: side }, data: { historyCompactionSummary: "Budget talk so far" } }));
    const firstSide = await branch({ taskThreadId: side, messageId: sideAnswer.id });
    const secondSide = await branch({ taskThreadId: side, messageId: sideAnswer.id });
    assert.deepEqual([firstSide.title, secondSide.title], ["Trip budget #2", "Trip budget #3"]);
    const grandRun = await turn(firstSide.threadId);
    await write(firstSide.threadId, { role: "user", blocks: text("Cheaper?"), runId: grandRun.id });
    const grandAnswer = await write(firstSide.threadId, { role: "bot", blocks: text("600 euros."), runId: grandRun.id });
    const grand = await branch({ taskThreadId: firstSide.threadId, messageId: grandAnswer.id });
    assert.equal(grand.title, "Trip budget #4");
    const grandTexts = (await runAsTenant(owner, () => prisma.message.findMany({ where: { threadId: grand.threadId }, orderBy: { seq: "asc" } })))
      .map((message) => (message.blocks as MessageBlock[])[0]!.kind === "text" ? (message.blocks as Array<{ text: string }>)[0]!.text : (message.blocks as MessageBlock[])[0]!.kind);
    assert.deepEqual(grandTexts, ["Estimate the budget", "About 900 euros.", "branch_origin", "Cheaper?", "600 euros.", "branch_origin"]);
    const sideCopy = await runAsTenant(owner, () => prisma.thread.findUniqueOrThrow({ where: { id: firstSide.threadId } }));
    assert.deepEqual([sideCopy.historyCompactionSummary, sideCopy.historyCompactedUpToSeq], ["Budget talk so far", 0]);
    const sealedSummary = await rows<{ summary: string }>(`SELECT "historyCompactionSummary" AS summary FROM threads WHERE id = $1`, [firstSide.threadId]);
    assert.ok(!sealedSummary[0]!.summary.includes("Budget talk"));
    await sql.query(`UPDATE threads SET "historyCompactedUpToSeq" = 99 WHERE id = $1`, [side]);
    const late = await branch({ taskThreadId: side, messageId: sideAnswer.id });
    const lateThread = await system.thread.findUniqueOrThrow({ where: { id: late.threadId } });
    assert.deepEqual([lateThread.historyCompactionSummary, lateThread.historyCompactedUpToSeq], [null, null]);
    checks.push("side branches are named \"{title} #N\" counting up across branches of branches, and carry a compacted summary only when it ends inside the copy, still encrypted");

    // 5. No conversation limit; the list reports the source; untitled sources fall back.
    for (let index = 0; index < 55; index += 1)
      await system.thread.create({ data: { spaceId: "space", userId: "owner", taskBotId: "mico", projectKey: "mico:mico", taskKey: `mico-task:mico:bulk-${index}`, title: `Bulk ${index}`, startedBy: "user" } });
    const many = await branch({ messageId: answer.id });
    assert.equal(many.title, "Plan the spring trip");
    const listed = await call("list", { botId: "mico" });
    const listedBranch = listed.find((row: { threadId: string }) => row.threadId === firstSide.threadId);
    assert.deepEqual([listedBranch.startedBy, listedBranch.kind, listedBranch.branchedFromThreadId, listedBranch.titleSource], ["branch", "conversation", side, "auto"]);
    assert.equal(listed.find((row: { threadId: string }) => row.threadId === side).branchedFromThreadId, undefined);
    const emptyRun = await turn(main);
    const lonely = await write(main, { role: "bot", blocks: text("A reply with no question"), runId: emptyRun.id });
    await write(main, { role: "system", blocks: [{ kind: "context_reset" }] });
    await sql.query(`UPDATE threads SET "contextStartSeq" = (SELECT max(seq) + 1 FROM messages WHERE "threadId" = $1) WHERE id = $1`, [main]);
    const afterReset = await branch({ messageId: lonely.id });
    assert.equal(afterReset.title, "Book the first one");
    const resetRun = await turn(main);
    const fresh = await write(main, { role: "bot", blocks: text("Fresh context reply"), runId: resetRun.id });
    const freshBranch = await branch({ messageId: fresh.id });
    assert.equal(freshBranch.title, BRANCH_TITLE_FALLBACK);
    assert.deepEqual((await system.message.findMany({ where: { threadId: freshBranch.threadId }, orderBy: { seq: "asc" }, select: { role: true } })).map((row) => row.role), ["bot", "system"]);
    checks.push("more than 50 open conversations never block a branch; the list names a branch's source; a branch starts at its turn's New chat boundary and falls back to a fixed title");

    // 6. Deleting the source never deletes the branch; deleting the branch removes only its copies.
    const sourceFiles = await system.artifact.findMany({ where: { id: { in: [report.id, photo.id] } } });
    const sideFile = await upload("budget.csv", "text/csv", "synthetic budget", sideRun.id);
    const sheet = await write(side, { role: "bot", blocks: [{ kind: "file", artifactId: sideFile.id, mimeType: "text/csv", name: "budget.csv", size: sideFile.size }], runId: sideRun.id });
    const withFile = await branch({ taskThreadId: side, messageId: sheet.id });
    const [sheetCopy] = await system.artifact.findMany({ where: { clientNonce: `branch-copy:${withFile.threadId}:${sideFile.id}` } });
    assert.ok(sheetCopy);
    await sql.query(`UPDATE threads SET "deleteAfter" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1`, [side]);
    assert.equal(await runAsTenant(owner, () => purgeDeletedThread({ prisma, artifacts: store, dataDir }, side, new Date(Date.now() + 60_000))), "purged");
    assert.equal(await system.artifact.count({ where: { id: sideFile.id } }), 0);
    await assert.rejects(readBytes(sideFile.storageKey));
    assert.equal(await readBytes(sheetCopy.storageKey), "synthetic budget");
    const orphan = await system.thread.findUniqueOrThrow({ where: { id: firstSide.threadId } });
    assert.deepEqual([orphan.branchedFromThreadId, orphan.branchedFromMessageId], [null, null]);
    assert.equal(await system.message.count({ where: { threadId: firstSide.threadId } }), 5);
    assert.equal(await system.message.count({ where: { threadId: withFile.threadId } }), 4);
    assert.equal((await call("list", { botId: "mico" })).find((row: { threadId: string }) => row.threadId === firstSide.threadId).branchedFromThreadId, null);
    await assert.rejects(branch({ taskThreadId: side, messageId: sideAnswer.id }), /not found/);
    checks.push("deleting the source removes its own files but leaves every branch with its messages and copied files; the branch's link to the source clears");
    await sql.query(`UPDATE threads SET "deleteAfter" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1`, [made.threadId]);
    assert.equal(await runAsTenant(owner, () => purgeDeletedThread({ prisma, artifacts: store, dataDir }, made.threadId, new Date(Date.now() + 60_000))), "purged");
    assert.equal(await system.artifact.count({ where: { id: { in: copies.map((copy) => copy.id) } } }), 0);
    for (const copy of copies) await assert.rejects(readBytes(copy.storageKey));
    assert.equal(await system.artifact.count({ where: { id: { in: sourceFiles.map((file) => file.id) } } }), 2);
    for (const file of sourceFiles) assert.ok(await readBytes(file.storageKey));
    const racedCopies = await system.artifact.findMany({ where: { clientNonce: { startsWith: `branch-copy:${pair[0].threadId}:` } } });
    for (const copy of racedCopies) assert.ok(await readBytes(copy.storageKey));
    assert.equal(await system.thread.count({ where: { id: main } }), 1);
    checks.push("deleting a branch removes the files copied for it and their storage; the source's files and other branches' copies stay");
  } finally {
    sql.release();
  }
  const result = { passed: true, checks, productionAccess: false, modelsCalled: false, directory };
  await writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (db) { await db.prisma.$disconnect(); await db.pool.end(); }
  await postgres.stop();
}
