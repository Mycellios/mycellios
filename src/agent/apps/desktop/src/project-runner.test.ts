import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadProjectRun, serviceOrder, validateRunConfig } from "./project-run-config.js";
import { ProjectServices } from "./project-services.js";
import { ProjectRunner } from "./project-runner.js";

let root: string;
const managers: ProjectServices[] = [];
const runners: ProjectRunner[] = [];
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "mycellios-project-run-")); });
afterEach(async () => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const manager of managers.splice(0)) manager.stop();
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});
const config = () => ({ version: 1, services: [{ id: "web", command: "node server.js" }], profiles: [{ id: "web", name: "Frontend", services: ["web"] }] });
const quote = (value: string) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
async function port() {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
async function fixture(count = 1) {
  const file = path.join(root, "service.cjs");
  await writeFile(file, `const fs=require('node:fs');fs.appendFileSync('order.txt',process.argv[2]+'\\n');const s=require('node:http').createServer((q,r)=>r.end('ready'));s.listen(Number(process.argv[3]),'127.0.0.1',()=>console.log('ready '+process.argv[2]));`);
  const services = [];
  for (let index = 0; index < count; index++) {
    const id = `service${index}`, number = await port();
    services.push({ id, command: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(file)} ${id} ${number}`, dependsOn: index ? [`service${index - 1}`] : [], ready: { url: `http://127.0.0.1:${number}/`, timeoutMs: 10000 } });
  }
  const value = { version: 1, services, profiles: [{ id: "all", name: "Application", services: [services.at(-1)!.id], url: services.at(-1)!.ready.url }] };
  await mkdir(path.join(root, ".mycellios")); await writeFile(path.join(root, ".mycellios/run.json"), JSON.stringify(value));
  return (await loadProjectRun(root))!;
}
it("validates dependency graphs, duplicate IDs, paths and loopback URLs", () => {
  expect(validateRunConfig(config()).profiles).toHaveLength(1);
  for (const mutate of [
    (c: any) => { c.services[0].cwd = "../outside"; },
    (c: any) => { c.services[0].cwd = "C:\\outside"; },
    (c: any) => { c.profiles[0].url = "https://example.com"; },
    (c: any) => { c.services.push({ ...c.services[0] }); },
    (c: any) => { c.services[0].dependsOn = ["web"]; },
    (c: any) => { c.services[0].dependsOn = ["missing"]; },
  ]) { const value = config(); mutate(value); expect(() => validateRunConfig(value)).toThrow(); }
});
it("preserves the startup refusal when cleanup emits a process exit", async () => {
  const project = await fixture();
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  let probes = 0, validations = 0, killed = 0;
  const manager = new ProjectServices({
    probe: async () => ++probes > 1,
    launch: () => ({ child: child as never, tree: {
      alive: () => true,
      kill() { killed++; child.emit("exit", 130); },
      close() {},
    } }),
  });
  managers.push(manager);
  manager.start(project, "all", async () => { if (++validations === 2) throw new Error("Original admission refusal"); });
  await manager.settled();
  expect(killed).toBe(1);
  expect(manager.state.error).toBe("Original admission refusal");
  expect(manager.state.phase).toBe("error");
});
it("includes transitive dependencies before consumers", () => {
  const value = validateRunConfig({ version: 1, services: [{ id: "api", command: "api" }, { id: "worker", command: "worker", dependsOn: ["api"] }, { id: "web", command: "web", dependsOn: ["worker"] }], profiles: [{ id: "all", name: "All", services: ["web"] }] });
  expect(serviceOrder(value, "all").map(s => s.id)).toEqual(["api", "worker", "web"]);
});
it("starts three real services in dependency order and stops its entire owned tree", async () => {
  const project = await fixture(3), manager = new ProjectServices(); managers.push(manager);
  manager.start(project, "all", async () => {});
  expect((await manager.settled()).phase).toBe("running");
  expect(manager.state.services.every(s => s.owned && s.phase === "running")).toBe(true);
  expect(await readFile(path.join(root, "order.txt"), "utf8")).toBe("service0\nservice1\nservice2\n");
  manager.start(project, "all", async () => {});
  expect(await readFile(path.join(root, "order.txt"), "utf8")).toBe("service0\nservice1\nservice2\n");
  manager.stop();
  await expect.poll(async () => Promise.all(project.config.services.map(s => manager.probe(s.ready!.url)))).toEqual([false, false, false]);
}, 30000);
it("refuses an occupied readiness endpoint without terminating the external server", async () => {
  const project = await fixture(), number = Number(new URL(project.config.services[0]!.ready!.url).port);
  const external = createServer((_q, r) => r.end("external"));
  await new Promise<void>(resolve => external.listen(number, "127.0.0.1", resolve));
  try {
    const manager = new ProjectServices(); managers.push(manager); manager.start(project, "all", async () => {});
    expect((await manager.settled()).phase).toBe("error");
    manager.stop(); expect(await manager.probe(project.config.services[0]!.ready!.url)).toBe(true);
  } finally { await new Promise<void>(resolve => external.close(() => resolve())); }
});
it("stops partial startup when a dependent command exits", async () => {
  const project = await fixture();
  project.config.services.push({ id: "broken", command: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} -e 'process.exit(7)'`, dependsOn: ["service0"] });
  project.config.profiles[0]!.services = ["broken"];
  const manager = new ProjectServices(); managers.push(manager); manager.start(project, "all", async () => {});
  await manager.settled();
  await expect.poll(() => manager.state.phase, { timeout: 15000 }).toBe("error");
  expect(manager.state.error).toMatch(/Service broken exited/);
  await expect.poll(() => manager.probe(project.config.services[0]!.ready!.url)).toBe(false);
}, 30000);
it("coalesces initial Play and waits for this request's machine-local binding", async () => {
  const runner = new ProjectRunner(path.join(root, "native")); runners.push(runner);
  const [first, second] = await Promise.all([runner.play("owner/chat", root, undefined, undefined, undefined, async () => {}), runner.play("owner/chat", root, undefined, undefined, undefined, async () => {})]);
  expect(first.phase).toBe("preparing"); expect(first.preparation?.id).toBe(second.preparation?.id);
  const project = await fixture();
  expect((await runner.state("owner/chat", root)).phase).toBe("preparing");
  const binding = path.join(root, "native", createHash("sha256").update("owner/chat").digest("hex"), "project.json");
  await writeFile(binding, JSON.stringify({ path: project.root, preparationId: first.preparation!.id }));
  expect((await runner.state("owner/chat", root)).phase).toBe("configured");
  runner.stop("owner/chat");
  await expect(runner.play("owner/chat", root, undefined, undefined, first.preparation!.id, async () => {})).rejects.toThrow("cancelled");
});
it("cannot resurrect a preparation after Stop while authorization is pending", async () => {
  const runner = new ProjectRunner(path.join(root, "native")); runners.push(runner);
  let resume!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const playing = runner.play("owner", root, undefined, undefined, undefined, async () => { entered(); await gate; });
  await ready; runner.stop("owner"); resume();
  await expect(playing).rejects.toThrow("cancelled");
  expect((await runner.state("owner", root)).phase).toBe("stopped");
});
it("honors immediate Stop while native storage is being prepared", async () => {
  const runner = new ProjectRunner(path.join(root, "native")); runners.push(runner);
  const playing = runner.play("owner", root, undefined, undefined, undefined, async () => {});
  runner.stop("owner");
  await expect(playing).rejects.toThrow("cancelled");
});
it("can prepare a repaired configuration after a failed service run", async () => {
  const project = await fixture();
  project.config.services[0]!.command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} -e 'process.exit(7)'`;
  await writeFile(path.join(root, ".mycellios/run.json"), JSON.stringify(project.config));
  const runner = new ProjectRunner(path.join(root, "native")); runners.push(runner);
  expect((await runner.play("owner", root, undefined, undefined, undefined, async () => {})).phase).toBe("starting");
  await expect.poll(async () => (await runner.state("owner", root)).phase, { timeout: 10000 }).toBe("error");
  await writeFile(path.join(root, ".mycellios/run.json"), "{}");
  expect((await runner.play("owner", root, undefined, undefined, undefined, async () => {})).phase).toBe("preparing");
  expect((await runner.state("owner", root)).phase).toBe("preparing");
});
