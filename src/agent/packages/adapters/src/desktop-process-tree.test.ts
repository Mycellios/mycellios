// @vitest-environment node
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { spawnOwnedCommand } from "./desktop-process-tree.js";
const owned: ReturnType<typeof spawnOwnedCommand>[] = [];
afterEach(async () => {
  for (const process of owned) { process.tree.kill(); process.tree.close(); }
  await Promise.all(owned.map(({ child }) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, "exit")));
  owned.length = 0;
});
it.skipIf(process.platform !== "win32")("owns independent trees when host and runner load separate module instances", async () => {
  const firstModule = await import("./desktop-process-tree.js");
  vi.resetModules();
  const secondModule = await import("./desktop-process-tree.js");
  const argv = [process.execPath, "-e", "process.stdout.write('ready');setInterval(()=>{},1000)"];
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP };
  for (const module of [firstModule, secondModule]) {
    const command = module.spawnOwnedCommand(argv, process.cwd(), env);
    owned.push(command);
    await once(command.child.stdout, "data");
    expect(command.tree.alive()).toBe(true);
  }
  owned[0]!.tree.kill(); owned[0]!.tree.close();
  expect(owned[1]!.tree.alive()).toBe(true);
}, 30000);
