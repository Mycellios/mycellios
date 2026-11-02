import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { listAgentSkillRecords } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { buildSkillMd } from "@rakazo/core";
import { describeRowSecurity, runAsSystem, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentSkillsService } from "./agent-skills.js";
import { freeLocalPort, startDesktopLocalServer } from "./desktop-local-server.js";
import { createTaskControls } from "./task-controls.js";

const local = process.env.VERIFY_DESKTOP_LOCAL === "1" ? describe.sequential : describe.skip;
local("desktop local database lifecycle", () => {
  let root: string;
  let handles: Awaited<ReturnType<typeof startDesktopLocalServer>>;
  const initialEnv = { ...process.env };
  const actor: Actor = {
    spaceId: "desktop-space",
    userId: "desktop-user",
    email: "fixture@example.test",
    isDeploymentOwner: true,
  };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rakazo-desktop-postgres-"));
    const webRoot = join(root, "web");
    await mkdir(webRoot);
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Local fixture</title>");
    const schemaRoot = resolve(
      fileURLToPath(new URL("../../../packages/db/prisma", import.meta.url)),
    );
    // Empty, uncommitted folders are not migration artifacts. Never alter another task's source.
    const fixtureMigrations = join(root, "migrations");
    await mkdir(fixtureMigrations);
    for (const entry of await readdir(join(schemaRoot, "migrations"), { withFileTypes: true })) {
      const from = join(schemaRoot, "migrations", entry.name);
      if (!entry.isDirectory()) {
        await cp(from, join(fixtureMigrations, entry.name));
        continue;
      }
      const files = await readdir(from);
      if (!files.length) continue;
      if (!files.includes("migration.sql")) throw new Error("A nonempty migration is missing SQL");
      await mkdir(join(fixtureMigrations, entry.name));
      await cp(join(from, "migration.sql"), join(fixtureMigrations, entry.name, "migration.sql"));
    }
    await writeFile(
      join(root, "prisma.config.mjs"),
      `export default { schema: ${JSON.stringify(join(schemaRoot, "schema.prisma"))}, migrations: { path: ${JSON.stringify(fixtureMigrations)} }, datasource: { url: process.env.DATABASE_MIGRATION_URL } };`,
    );
    handles = await startDesktopLocalServer({
      dataDir: join(root, "data"),
      webRoot,
      migrationsRoot: root,
      port: await freeLocalPort(),
      token: "a".repeat(64),
      build: "fixture",
    });
    await runAsSystem("local desktop fixture", async () => {
      const db = handles.prisma;
      await db.organization.create({
        data: {
          id: "desktop-org",
          name: "Fixture",
          slug: "desktop-fixture",
          createdAt: new Date(),
        },
      });
      await db.user.create({
        data: { id: actor.userId, email: actor.email, name: "Fixture", emailVerified: true },
      });
      await db.space.create({
        data: { id: actor.spaceId, name: "Fixture", organizationId: "desktop-org" },
      });
      await db.bot.createMany({
        data: ["agent-a", "agent-b"].map((id) => ({
          id,
          spaceId: actor.spaceId,
          userId: actor.userId,
          name: id,
          color: "forest",
        })),
      });
      await db.chatGroup.create({
        data: {
          id: "desktop-group",
          spaceId: actor.spaceId,
          userId: actor.userId,
          name: "Fixture",
          members: { create: [{ botId: "agent-a" }, { botId: "agent-b" }] },
        },
      });
      await db.thread.create({
        data: {
          id: "desktop-thread",
          spaceId: actor.spaceId,
          userId: actor.userId,
          groupId: "desktop-group",
        },
      });
    });
  }, 180000);
  afterAll(async () => {
    await handles?.close();
    for (const key of Object.keys(process.env)) if (!(key in initialEnv)) delete process.env[key];
    Object.assign(process.env, initialEnv);
    if (root) await rm(root, { recursive: true, force: true });
  }, 30000);
  it("serves a local app with a database login that cannot bypass tenant policies", async () => {
    expect((await fetch(`${handles.origin}/ready`)).status).toBe(200);
    expect(await (await fetch(handles.origin)).text()).toContain("Local fixture");
    await expect(describeRowSecurity(handles.prisma)).resolves.toMatchObject({ enforced: true });
  });
  it("refuses to open a second server over a live profile", async () => {
    await expect(
      startDesktopLocalServer({
        dataDir: join(root, "data"),
        webRoot: join(root, "web"),
        migrationsRoot: root,
        port: await freeLocalPort(),
        token: "a".repeat(64),
        build: "fixture",
      }),
    ).rejects.toThrow("already running");
    expect((await fetch(`${handles.origin}/ready`)).status).toBe(200);
  });
  it("snapshots library updates, rejects stale edits and restores without changing a pinned agent", async () =>
    runAsTenant(actor, async () => {
      const service = createAgentSkillsService(handles.prisma);
      const first = await service.create(actor, {
        name: "Review",
        description: "Review code",
        body: "Original recipe",
      });
      expect(first.revision).toBe(1);
      await service.pin(actor, { botId: "agent-a", skillId: first.id, revision: 1 });
      const second = await service.update(actor, {
        skillId: first.id,
        expectedRevision: 1,
        body: "Updated recipe",
      });
      expect(second.revision).toBe(2);
      expect(
        (await listAgentSkillRecords(handles.prisma, { ...actor, botId: "agent-a" })).find(
          (skill) => skill.id === first.id,
        )?.content,
      ).toBe(first.content);
      await expect(
        service.update(actor, { skillId: first.id, expectedRevision: 1, body: "Stale" }),
      ).rejects.toThrow("changed");
      const restored = await service.restore(actor, {
        skillId: first.id,
        revision: 1,
        expectedRevision: 2,
      });
      expect(restored.revision).toBe(3);
      expect(restored.content).toBe(first.content);
      const pin = await handles.prisma.botSkillPin.findFirst({
        where: { botId: "agent-a", skillId: first.id },
        include: { version: true },
      });
      expect(pin?.revision).toBe(1);
      expect(pin?.version.content).toBe(first.content);
      await expect(
        handles.prisma.agentSkillRevision.updateMany({
          where: { skillId: first.id, revision: 1 },
          data: { content: "tampered" },
        }),
      ).rejects.toThrow();
      expect(
        (await service.history(actor, { skillId: first.id })).map((row) => row.revision),
      ).toEqual([3, 2, 1]);
      await expect(
        runAsTenant({ spaceId: "other-space", userId: "other-user" }, () =>
          service.history(
            { ...actor, spaceId: "other-space", userId: "other-user" },
            { skillId: first.id },
          ),
        ),
      ).rejects.toThrow();
    }));
  it("also snapshots old-writer updates that omit the new revision column", async () =>
    runAsTenant(actor, async () => {
      const skill = await handles.prisma.agentSkill.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          name: "Old writer",
          description: "Fixture",
          content: buildSkillMd({ name: "Old writer", description: "Fixture", body: "before" }),
        },
      });
      await handles.prisma.agentSkill.update({
        where: { id: skill.id },
        data: {
          content: buildSkillMd({ name: "Old writer", description: "Fixture", body: "after" }),
        },
      });
      expect(await handles.prisma.agentSkillRevision.count({ where: { skillId: skill.id } })).toBe(
        2,
      );
    }));
  it("reassigns a paused task without losing its original run or thread", async () =>
    runAsTenant(actor, async () => {
      const db = handles.prisma;
      const task = await db.task.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: "agent-a",
          threadId: "desktop-thread",
          prompt: "Continue fixture",
          status: "cancelled",
          paused: true,
        },
      });
      const run = await db.run.create({
        data: {
          taskId: task.id,
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: "agent-a",
          threadId: "desktop-thread",
          status: "cancelled",
          trigger: "user",
        },
      });
      const jobs = {
        enqueue: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
      } as unknown as JobPublisher;
      const controls = createTaskControls({
        prisma: db,
        jobs,
        sandbox: {} as never,
        events: {} as never,
      });
      const changed = await controls.control(actor, {
        runId: run.id,
        expectedVersion: 1,
        action: "reassign",
        botId: "agent-b",
      });
      expect(changed.version).toBe(2);
      expect(changed.runId).not.toBe(run.id);
      const rows = await db.run.findMany({
        where: { taskId: task.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.threadId === "desktop-thread")).toBe(true);
      expect(rows[0]?.botId).toBe("agent-a");
      expect(rows[1]?.botId).toBe("agent-b");
      await expect(
        controls.control(actor, {
          runId: run.id,
          expectedVersion: 1,
          action: "reassign",
          botId: "agent-a",
        }),
      ).rejects.toThrow();
    }));
  it("pauses only its task and waits for an old worker lease before resuming", async () =>
    runAsTenant(actor, async () => {
      const db = handles.prisma;
      const create = async () => {
        const task = await db.task.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: "agent-a",
            threadId: "desktop-thread",
            prompt: "Pause fixture",
            status: "queued",
          },
        });
        return db.run.create({
          data: {
            taskId: task.id,
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: "agent-a",
            threadId: "desktop-thread",
            status: "queued",
            trigger: "user",
          },
        });
      };
      const run = await create();
      const sibling = await create();
      const jobs = {
        enqueue: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
      } as unknown as JobPublisher;
      const controls = createTaskControls({
        prisma: db,
        jobs,
        sandbox: {} as never,
        events: { notify: vi.fn(async () => undefined) } as never,
      });
      await db.run.update({
        where: { id: run.id },
        data: { leaseOwner: "old-worker", leaseExpiresAt: new Date(Date.now() + 60000) },
      });
      const paused = await controls.control(actor, {
        runId: run.id,
        expectedVersion: 1,
        action: "pause",
      });
      expect(paused).toMatchObject({ paused: true, version: 2 });
      expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("cancelled");
      expect((await db.run.findUniqueOrThrow({ where: { id: sibling.id } })).status).toBe("queued");
      await expect(
        controls.control(actor, { runId: run.id, expectedVersion: 2, action: "resume" }),
      ).rejects.toThrow();
      await db.run.update({
        where: { id: run.id },
        data: { leaseOwner: null, leaseExpiresAt: null },
      });
      const resumed = await controls.control(actor, {
        runId: run.id,
        expectedVersion: 2,
        action: "resume",
      });
      expect(resumed).toMatchObject({ paused: false, version: 3 });
      expect(resumed.runId).not.toBe(run.id);
      expect(await db.run.count({ where: { taskId: run.taskId } })).toBe(2);
    }));
  it("reopens its database and skill history with the same private identity", async () => {
    await handles.close();
    handles = await startDesktopLocalServer({
      dataDir: join(root, "data"),
      webRoot: join(root, "web"),
      migrationsRoot: root,
      port: await freeLocalPort(),
      token: "a".repeat(64),
      build: "fixture",
    });
    expect((await fetch(`${handles.origin}/ready`)).status).toBe(200);
    expect(
      await runAsTenant(actor, () => handles.prisma.agentSkillRevision.count()),
    ).toBeGreaterThanOrEqual(3);
  });
});
