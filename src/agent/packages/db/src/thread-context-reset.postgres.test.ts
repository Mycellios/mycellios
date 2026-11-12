import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "./client.js";
import { resetThreadContext } from "./thread-context-reset.js";
import { loadRunHistoryMessages } from "./messages.js";
const postgres = process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;
postgres("new-chat transaction (isolated PostgreSQL temporary tables)", () => {
 let pool: Pool, prisma: PrismaClient;
 const actor = { userId: "owner", spaceId: "space" }, input = { botId: "bot", threadId: "chat", clientNonce: "once" };
 beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: "-c search_path=pg_temp" }); prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema: "pg_temp" }) });
  await pool.query(`CREATE TEMP TABLE threads (id text PRIMARY KEY, "spaceId" text, "userId" text, "botId" text, "taskBotId" text,
   "nextMessageSeq" integer DEFAULT 0, "nextEventSeq" integer DEFAULT 0, "contextStartSeq" integer DEFAULT 0,
   "historyCompactedUpToSeq" integer, "historyCompactionSummary" text, "historyCompactionGeneration" integer DEFAULT 0, "agentContextReset" jsonb, unread boolean DEFAULT false);
   CREATE TEMP TABLE messages (id text PRIMARY KEY, "threadId" text, seq integer, role text, blocks jsonb,
   "botId" text, "replyToMessageId" text, "replyQuote" text, "runId" text, "clientNonce" text, "searchTokens" integer[] DEFAULT '{}', "createdAt" timestamptz DEFAULT now(), UNIQUE("threadId",seq), UNIQUE("threadId","clientNonce"));
   CREATE TEMP TABLE runs (id text PRIMARY KEY, "spaceId" text, "threadId" text, status text, checkpoint text, "updatedAt" timestamptz DEFAULT now());
   CREATE TEMP TABLE steering_messages (id text PRIMARY KEY, "messageId" text, "botId" text, "runId" text, "originTrigger" text, "claimedAt" timestamptz);
   CREATE TEMP TABLE events (id text PRIMARY KEY, "spaceId" text, "threadId" text, "botId" text, seq integer, type text, payload jsonb, "runId" text, "createdAt" timestamptz DEFAULT now());`);
 });
 beforeEach(async () => { await pool.query(`TRUNCATE pg_temp.threads,pg_temp.messages,pg_temp.runs,pg_temp.steering_messages,pg_temp.events;
  INSERT INTO threads (id,"spaceId","userId","botId","nextMessageSeq","historyCompactionSummary") VALUES ('chat','space','owner','bot',2,'Old summary');
  INSERT INTO messages (id,"threadId",seq,role,blocks) VALUES ('old-user','chat',0,'user','[{"kind":"text","text":"old private fact"}]'), ('old-bot','chat',1,'bot','[{"kind":"text","text":"old answer"}]');
  INSERT INTO runs VALUES ('old-run','space','chat','failed','{"old":"checkpoint"}');`); });
 afterAll(async () => { await prisma?.$disconnect(); await pool?.end(); });
 it("preserves old messages, clears only execution context and deduplicates retry", async () => {
  await resetThreadContext(prisma, actor, input); await resetThreadContext(prisma, actor, input);
  expect((await pool.query('SELECT count(*)::int n FROM messages')).rows[0].n).toBe(3);
  expect((await pool.query('SELECT "contextStartSeq","historyCompactionGeneration","historyCompactionSummary" FROM threads')).rows[0]).toEqual({contextStartSeq:3,historyCompactionGeneration:1,historyCompactionSummary:null});
  expect((await pool.query('SELECT checkpoint FROM runs')).rows[0].checkpoint).toBeNull();
  await pool.query(`INSERT INTO messages (id,"threadId",seq,role,blocks) VALUES ('fresh','chat',3,'user','[{"kind":"text","text":"fresh instruction"}]')`);
  expect((await loadRunHistoryMessages(prisma,{id:"next-run",threadId:"chat"},20,undefined,3)).map(m => m.id)).toEqual(["fresh"]);
 });
 it("rolls back while a run is active, retaining every message and checkpoint", async () => {
  await pool.query("UPDATE runs SET status='running'");
  await expect(resetThreadContext(prisma,actor,input)).rejects.toThrow("Wait for the current task");
  expect((await pool.query('SELECT "contextStartSeq","nextMessageSeq" FROM threads')).rows[0]).toEqual({contextStartSeq:0,nextMessageSeq:2});
  expect((await pool.query('SELECT count(*)::int n FROM events')).rows[0].n).toBe(0);
 });
 it("refuses a different account or Space before changing anything", async () => {
  await expect(resetThreadContext(prisma,{...actor,userId:"stranger"},input)).rejects.toThrow();
  await expect(resetThreadContext(prisma,{...actor,spaceId:"other"},input)).rejects.toThrow();
  expect((await pool.query('SELECT "contextStartSeq" FROM threads')).rows[0].contextStartSeq).toBe(0);
 });
});
