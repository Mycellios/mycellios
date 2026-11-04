import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startHostComputerServer } from "./host-computer-server.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
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
    );
    const one = { ...base, projectSessionId: "thread-one", runId: "run-one" };
    await client.writeFile(
      primary,
      { path: "task.txt", content: new TextEncoder().encode("one") },
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
    await expect(
      host.bindTaskProject("thread-two", "mico", path.join(root, "two"), async () => {}),
    ).rejects.toThrow("active local task");
    first();
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
