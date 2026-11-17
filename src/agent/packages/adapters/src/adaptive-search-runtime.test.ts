import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { dockerAdaptiveSearchCommand } from "./docker-search-budget.js";
import { shellQuote } from "@rakazo/core/node/desktop-runtime";
const context = { runId: "adaptive-search", userId: "fixture", spaceId: "fixture", operationId: "fixture", traceId: "fixture", signal: new AbortController().signal };
it("extends one real native search while an unrelated command remains intact", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "adaptive-search-")));
  const provider = new DesktopSandboxProvider({ root });
  const computer = await provider.provision({ botId: "fixture", homePath: root }, context);
  const collect = async (script: string, runId: string, progress: boolean) => {
    const events = [];
    for await (const e of provider.execute(computer, { argv: [process.execPath, "-e", script], timeoutMs: progress ? 700 : 3000, ...(progress ? { searchProgress: { maxMs: 2200, roots: ["src"] } } : {}) }, { ...context, runId })) events.push(e);
    return events;
  };
  try {
    const [search, other] = await Promise.all([
      collect('console.log("src/a.ts:1:hit");setTimeout(()=>console.log("src/b.ts:2:hit"),450);setTimeout(()=>process.exit(0),950)', "search", true),
      collect('setTimeout(()=>{console.log("unrelated complete");process.exit(0)},1100)', "other", false),
    ]);
    expect(search.at(-1)).toEqual({ type: "exit", code: 0 });
    expect(other.at(-1)).toEqual({ type: "exit", code: 0 });
    const noise = await collect('console.log("src/same.ts");setInterval(()=>console.log("src/same.ts"),100)', "noise", true);
    expect(noise.at(-1)).toEqual({ type: "exit", code: 124 });
  } finally { provider.cancelAllCommands(); await provider.settleCommands(); await rm(root, { recursive: true, force: true }); }
});
it.skipIf(process.platform === "win32")("enforces Docker search idle deadlines and keeps genuine progress alive", async () => {
  const run = (script: string) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const command = `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
    const child = spawn("bash", ["-lc", dockerAdaptiveSearchCommand(command, 700, { maxMs: 2200, roots: ["src"] })], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.on("data", b => stderr += b); child.once("error", reject); child.once("exit", code => resolve({ code, stderr }));
  });
  expect((await run('console.log("src/a.ts");setTimeout(()=>console.log("src/b.ts"),450);setTimeout(()=>process.exit(0),950)')).code).toBe(0);
  const quiet = await run('setInterval(()=>{},100)');
  expect(quiet.code).toBe(124); expect(quiet.stderr).toContain("partial results do not prove absence");
  expect((await run('console.log("src/same.ts");setInterval(()=>console.log("src/same.ts"),100)')).code).toBe(124);
});
