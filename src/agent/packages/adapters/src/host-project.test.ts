import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startHostComputerServer>>[] = [];

it("starts in a private native workspace without selecting a project folder", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-no-picker-"))); roots.push(root);
  const token = "cd".repeat(32);
  const server = await startHostComputerServer({ root, token, hostname: "127.0.0.1" }); servers.push(server);
  const client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  const context = { operationId: "no-picker-qa", traceId: "no-picker-qa", spaceId: "qa", userId: "qa", signal: new AbortController().signal };
  await expect(client.provision({ botId: "first", homePath: "" }, context)).rejects.toThrow();
  server.setEnabled(true);
  const first = await client.provision({ botId: "first", homePath: "" }, context);
  const other = await client.provision({ botId: "other", homePath: "" }, context);
  expect(server.project("first")).toBeNull();
  await client.writeFile(first, { path: "example.mjs", content: new TextEncoder().encode("export const total = 121;") }, context);
  await expect(client.readFile(other, "example.mjs", context)).rejects.toThrow();
  const events = [];
  for await (const event of client.execute(first, { argv: [process.execPath, "--input-type=module", "-e",
    "import {total} from './example.mjs';import assert from 'node:assert/strict';assert.equal(total,121);console.log('native workspace verified')"],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}, timeoutMs: 10000 }, context)) events.push(event);
  expect(events).toContainEqual({ type: "exit", code: 0 });
  expect(events.some(e => e.type === "stdout" && e.data.includes("native workspace verified"))).toBe(true);
  server.setEnabled(false);
  await expect(client.readFile(first, "example.mjs", context)).rejects.toThrow();
}, 30000);
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) {
    expect(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});
it("opens a project and modifies it through the real native shell, with a real test exit code", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-project-"))); roots.push(root);
  const project = path.join(root, "project"); await mkdir(project);
  await writeFile(path.join(project, "index.html"), "<h1>Before</h1>");
  const token = "ab".repeat(32);
  const server = await startHostComputerServer({ root: path.join(root, "computer"), token, hostname: "127.0.0.1" }); servers.push(server);
  await expect(server.selectProject("bot", project)).rejects.toThrow("disabled");
  server.setEnabled(true);
  await server.selectProject("bot", project);
  const client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
  const context = { operationId: "project-qa", traceId: "project-qa", spaceId: "qa", userId: "qa", signal: new AbortController().signal };
  const computer = await client.provision({ botId: "bot", homePath: "" }, context);
  expect((await client.environment(computer, context)).projectPath).toBe(project);
  await client.writeFile(computer, { path: "project/note.txt", content: new TextEncoder().encode("Native file tool") }, context);
  expect(new TextDecoder().decode(await client.readFile(computer, "project/note.txt", context))).toBe("Native file tool");
  expect(await client.listFiles(computer, "project", context)).toContainEqual(expect.objectContaining({ path: "project/note.txt", kind: "file" }));
  await expect(client.writeFile(computer, { path: "project/../escape.txt", content: new Uint8Array() }, context)).rejects.toThrow();
  const events = [];
  for await (const event of client.execute(computer, { argv: [process.execPath, "-e",
    "const fs=require('node:fs');fs.writeFileSync('index.html','<h1>Mycellios local project</h1>');require('node:assert/strict').match(fs.readFileSync('index.html','utf8'),/Mycellios local project/);console.log('project test passed')"],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}, timeoutMs: 10000 }, context)) events.push(event);
  expect(events).toContainEqual({ type: "exit", code: 0 });
  expect(events.some((e) => e.type === "stdout" && e.data.includes("project test passed"))).toBe(true);
  expect(await readFile(path.join(project, "index.html"), "utf8")).toBe("<h1>Mycellios local project</h1>");
  const failed = [];
  for await (const event of client.execute(computer, { argv: [process.execPath, "-e", "process.exit(1)"],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}, timeoutMs: 10000 }, context)) failed.push(event);
  expect(failed).toContainEqual({ type: "exit", code: 1 });
  // Start a real project preview using the same command transport, then revoke access.
  let ready!: (url: string) => void;
  let failReady!: (reason: unknown) => void;
  const preview = new Promise<string>((resolve, reject) => { ready = resolve; failReady = reject; });
  const output: unknown[] = [];
  const work = (async () => {
    let stdout = "";
    for await (const event of client.execute(computer, { argv: [process.execPath, "-e",
      "const fs=require('node:fs');const s=require('node:http').createServer((q,r)=>r.end(fs.readFileSync('index.html')));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port))"],
      env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}, timeoutMs: 10000 }, context)) {
      output.push(event);
      if (event.type === "stdout") { stdout += event.data; if (stdout.includes("\n")) ready(stdout.trim()); }
    }
  })().catch(failReady);
  const previewUrl = await preview;
  expect(await (await fetch(previewUrl, { signal: AbortSignal.timeout(3000) })).text()).toBe("<h1>Mycellios local project</h1>");
  await expect(server.selectProject("bot", project)).rejects.toThrow();
  expect(server.project("bot")?.path).toBe(project);
  expect(await (await fetch(previewUrl, { signal: AbortSignal.timeout(3000) })).text()).toBe("<h1>Mycellios local project</h1>");
  const other = await client.provision({ botId: "other", homePath: "" }, context);
  expect((await client.environment(other, context)).projectPath).toBeUndefined();
  server.setEnabled(false);
  await work;
  await expect(fetch(previewUrl, { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
  await expect(client.environment(computer, context)).rejects.toThrow("unavailable");
}, 30000);
