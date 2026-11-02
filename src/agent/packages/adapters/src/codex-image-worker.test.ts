import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { CODEX_IMAGE_WORKER } from "./codex-image-worker.js";

const nativeRequire = createRequire(import.meta.url);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=";
async function fixture(
  options: {
    account?: string;
    image?: string;
    failed?: boolean;
    stale?: boolean;
    savedPath?: string;
  } = {},
) {
  const methods: string[] = [],
    spawned: string[][] = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
      write(line: string) {
        const message = JSON.parse(line);
        if (!message.id) return;
        methods.push(message.method);
        const result =
          message.method === "account/read"
            ? { account: { type: options.account ?? "chatgpt" } }
            : message.method === "model/list"
              ? { data: [{ id: "model", model: "model", isDefault: true }] }
              : message.method === "thread/start"
                ? { thread: { id: "thread" } }
                : message.method === "turn/start"
                  ? { turn: { id: "turn" } }
                  : {};
        queueMicrotask(() => {
          child.stdout.emit("data", JSON.stringify({ id: message.id, result }) + "\n");
          if (message.method !== "turn/start") return;
          child.stdout.emit(
            "data",
            JSON.stringify({
              method: "turn/started",
              params: { threadId: "thread", turn: { id: "turn" } },
            }) + "\n",
          );
          const item = {
            id: "image",
            type: "imageGeneration",
            status: "completed",
            result: options.image ?? png,
            savedPath: options.savedPath,
          };
          if (options.stale)
            child.stdout.emit(
              "data",
              JSON.stringify({
                method: "item/completed",
                params: { threadId: "another-thread", turnId: "turn", item },
              }) + "\n",
            );
          else
            child.stdout.emit(
              "data",
              JSON.stringify({
                method: "item/completed",
                params: { threadId: "thread", turnId: "turn", item },
              }) + "\n",
            );
          child.stdout.emit(
            "data",
            JSON.stringify({
              method: "turn/completed",
              params: {
                threadId: "thread",
                turn: { id: "turn", status: options.failed ? "failed" : "completed" },
              },
            }) + "\n",
          );
        });
      },
    }),
    stdout: Object.assign(new EventEmitter(), { setEncoding() {} }),
    stderr: { resume() {} },
    exitCode: null as number | null,
    kill() {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("close", 0));
    },
  });
  let output = "";
  const fakeProcess = {
    platform: "linux",
    env: { PATH: "/fixture/bin", OPENAI_API_KEY: "must-not-be-inherited" },
    execPath: "/fixture/node",
    argv: [
      "node",
      Buffer.from(JSON.stringify({ nonce: "a".repeat(32), prompt: "draw" })).toString("base64"),
    ],
    stdout: {
      write(s: string) {
        output += s;
      },
    },
    exitCode: 0,
  };
  await vm.runInNewContext(CODEX_IMAGE_WORKER, {
    Buffer,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 1000)),
    clearTimeout,
    process: fakeProcess,
    require(name: string) {
      if (name === "node:child_process")
        return {
          spawn(_file: string, args: string[], opts: { env: Record<string, string> }) {
            spawned.push(args);
            expect(opts.env.OPENAI_API_KEY).toBeUndefined();
            return child;
          },
        };
      if (name === "node:fs") return { existsSync: () => true };
      return nativeRequire(name);
    },
  });
  return { result: JSON.parse(output), methods, spawned, exit: fakeProcess.exitCode };
}
describe("native image protocol", () => {
  it("requires the current successful thread and turn and emits only its PNG", async () => {
    const f = await fixture();
    expect(f.result).toMatchObject({ nonce: "a".repeat(32), mimeType: "image/png", data: png });
    expect(f.exit).toBe(0);
    expect(f.spawned[0]).toContain("mcp_servers={}");
    expect(f.spawned[0]).toContain("shell_tool");
    expect(f.spawned[0]).toContain("apps");
    expect(f.spawned[0]).toContain("plugins");
    expect(f.methods.filter((m) => m === "turn/start")).toHaveLength(1);
  });
  it("does not use an API-key account or start a billed turn after authentication refusal", async () => {
    const f = await fixture({ account: "apiKey" });
    expect(f.result.error).toBe("authentication");
    expect(f.methods).not.toContain("turn/start");
  });
  it.each([{ stale: true }, { failed: true }, { image: "not valid base64!" }])(
    "rejects stale events, failed turns and malformed output",
    async (options) => {
      const f = await fixture(options);
      expect(f.exit).toBe(1);
      expect(f.result).not.toHaveProperty("data");
    },
  );
  it("never reads an arbitrary provider-supplied path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-path-fixture-"));
    try {
      const file = path.join(dir, "private.png");
      await fs.writeFile(file, Buffer.from(png, "base64"));
      const f = await fixture({ image: "", savedPath: file });
      expect(f.result.error).toBe("generation_failed");
      expect(f.result).not.toHaveProperty("data");
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
});
