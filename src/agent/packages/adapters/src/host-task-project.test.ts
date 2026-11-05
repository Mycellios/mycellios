import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startHostComputerServer } from "./host-computer-server.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { executionWorkspaceMode, resolveBotWorkspaceCwd, resolveBotWorkspacePath } from "./computer-support.js";
it("keeps two task worktrees separate on the same Mico and refuses unbound or old-worker operations", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mc-task-host-"))),
    token = "ab".repeat(32);
  const host = await startHostComputerServer({ root, token, hostname: "127.0.0.1" });
  try {
    host.setEnabled(true);
    for (const name of ["one", "two"]) await mkdir(path.join(root, name));
    const client = new HostComputerSandbox(`http://127.0.0.1:${host.port}`, token),
      base = {
        operationId: "test",
        traceId: "test",
        spaceId: "space",
        userId: "owner",
        botId: "mico",
        signal: new AbortController().signal,
      };
    const primary = await client.provision({ botId: "mico", homePath: "" }, base);
    await client.writeFile(
      primary,
      { path: "keep.txt", content: new TextEncoder().encode("primary unchanged") },
      base,
    );
    const first = await host.bindTaskProject(
      "thread-one",
      "mico",
      path.join(root, "one"),
      async () => {},
      undefined,
      async runId => runId === "ordinary-run",
    );
    const one = { ...base, projectSessionId: "thread-one", runId: "run-one" };
    await client.writeFile(
      primary,
      { path: resolveBotWorkspacePath(executionWorkspaceMode("team", one.projectSessionId), "mico", "project/task.txt"), content: new TextEncoder().encode("one") },
      one,
    );
    await expect(
      client.writeFile(
        primary,
        { path: "keep.txt", content: new TextEncoder().encode("bad") },
        base,
      ),
    ).rejects.toThrow("Unscoped");
    await expect(
      client.readFile(primary, "task.txt", { ...one, projectSessionId: "unknown" }),
    ).rejects.toThrow("Link this task");
    const parallel = await host.bindTaskProject("thread-two", "mico", path.join(root, "two"), async () => {});
    const parallelContext = { ...base, projectSessionId: "thread-two", runId: "run-two" };
    expect(await client.environment(primary, parallelContext)).toMatchObject({ projectSessionId: "thread-two", taskIsolation: "worktree-v1" });
    expect(await client.environment(primary, base)).not.toHaveProperty("taskIsolation");
    await Promise.all([
      client.writeFile(primary, { path: "concurrent.txt", content: new TextEncoder().encode("first") }, one),
      client.writeFile(primary, { path: "concurrent.txt", content: new TextEncoder().encode("second") }, parallelContext),
    ]);
    expect(await readFile(path.join(root, "one/concurrent.txt"), "utf8")).toBe("first");
    expect(await readFile(path.join(root, "two/concurrent.txt"), "utf8")).toBe("second");
    const ordinary = { ...base, runId: "ordinary-run" };
    await client.writeFile(primary, { path: "ordinary.txt", content: new TextEncoder().encode("primary workspace") }, ordinary);
    expect(new TextDecoder().decode(await client.readFile(primary, "ordinary.txt", ordinary))).toBe("primary workspace");
    await expect(readFile(path.join(root, "one/ordinary.txt"))).rejects.toThrow();
    await expect(client.writeFile(primary, { path: "bad.txt", content: new TextEncoder().encode("old worker") }, { ...base, runId: "project-run" })).rejects.toThrow("Unscoped");
    const started = new Set<string>();
    let bothReady!: () => void;
    const ready = new Promise<void>(resolve => { bothReady = resolve; });
    const run = async (context: typeof one, name: string) => {
      const events = [];
      for await (const event of client.execute(primary, { argv: [process.execPath, "-e",
        "console.log('ready'); const fs=require('fs'); const timer=setInterval(()=>{if(fs.existsSync('release.flag')){fs.writeFileSync('finished.txt','done');clearInterval(timer)}},20)"],
        cwd: resolveBotWorkspaceCwd(executionWorkspaceMode("team", context.projectSessionId), "mico", undefined),
        env: { SystemRoot: process.env.SystemRoot ?? "", PATH: process.env.PATH ?? "" } }, context)) {
        events.push(event);
        if (event.type === "stdout") { started.add(name); if (started.size === 2) bothReady(); }
      }
      return events;
    };
    const runningOne = run(one, "one");
    const oneEnded = runningOne.catch(() => []);
    const runningTwo = run(parallelContext, "two");
    await ready;
    // Stop/crash recovery gets its destination from the stored computer lease.
    await client.cancelRunWork(primary, primary.id, "run-one", { ...base, botId: "task-worktree:mico:thread-one", runId: "run-one" });
    await expect(client.cancelRunWork(primary, primary.id, "run-one", { ...parallelContext, botId: "task-worktree:mico:thread-one" }))
      .rejects.toThrow("another project conversation");
    await oneEnded;
    await expect(readFile(path.join(root, "one/finished.txt"))).rejects.toThrow();
    await writeFile(path.join(root, "two/release.flag"), "continue only the second conversation");
    const twoEvents = await runningTwo;
    expect(twoEvents.some(event => event.type === "exit" && event.code === 0)).toBe(true);
    expect(await readFile(path.join(root, "two/finished.txt"), "utf8")).toBe("done");
    first();
    expect(new TextDecoder().decode(await client.readFile(primary, "concurrent.txt", parallelContext))).toBe("second");
    parallel();
    await expect(client.readFile(primary, "task.txt", one)).rejects.toThrow();
    const second = await host.bindTaskProject(
      "thread-two",
      "mico",
      path.join(root, "two"),
      async () => {},
    );
    const two = { ...base, projectSessionId: "thread-two", runId: "run-two" };
    await client.writeFile(
      primary,
      { path: "task.txt", content: new TextEncoder().encode("two") },
      two,
    );
    expect(await readFile(path.join(root, "one/task.txt"), "utf8")).toBe("one");
    expect(await readFile(path.join(root, "two/task.txt"), "utf8")).toBe("two");
    await expect(
      client.readFile(primary, "task.txt", { ...two, botId: "different" }),
    ).rejects.toThrow("Link this task");
    second();
    expect(new TextDecoder().decode(await client.readFile(primary, "keep.txt", base))).toBe(
      "primary unchanged",
    );
    expect(host.project("mico")).toBeNull();
    host.clearProjects();
    await expect(client.readFile(primary, "task.txt", two)).rejects.toThrow("Link this task");
  } finally {
    await host.close();
    if (!path.basename(root).startsWith("mc-task-host-")) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}, 20000);
