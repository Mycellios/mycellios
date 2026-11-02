import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalNativeStackController } from "./local-native-stack.js";

class Child extends EventEmitter {
  postMessage(message: unknown) {
    if (message === "stop") queueMicrotask(() => this.emit("exit", 0));
  }
  kill() {
    this.emit("exit", 1);
    return true;
  }
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "rakazo-local-stack-"));
  const children: Child[] = [];
  let config: Record<string, unknown> | undefined;
  const controller = new LocalNativeStackController({
    dataDir: join(root, "data"),
    stackDir: join(root, "stack"),
    webRoot: join(root, "web"),
    migrationsRoot: join(root, "server"),
    localWebUrl: "http://127.0.0.1:45173",
    build: "fixture",
    launch(file) {
      const child = new Child();
      children.push(child);
      void readFile(file, "utf8").then((raw) => {
        config = JSON.parse(raw);
        child.emit("message", { type: "ready", origin: `http://127.0.0.1:${config!.port}` });
      });
      return child;
    },
  });
  cleanups.push(async () => {
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  });
  return { controller, root, children, config: () => config };
}
describe("native desktop local lifecycle", () => {
  it("starts only once and retains private data when stopped", async () => {
    const test = await setup();
    const starting = test.controller.start();
    expect(test.controller.start()).toBe(starting);
    expect((await starting).phase).toBe("ready");
    expect(test.children).toHaveLength(1);
    expect(typeof test.config()?.port).toBe("number");
    expect(test.config()?.token).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(join(test.root, "data", "retained.txt"), "keep");
    await test.controller.stop();
    expect(test.controller.state().phase).toBe("idle");
    expect(await readFile(join(test.root, "data", "retained.txt"), "utf8")).toBe("keep");
  });
  it("a stop supersedes a start that has not launched a child", async () => {
    const test = await setup();
    const starting = test.controller.start();
    await test.controller.stop();
    await starting;
    expect(test.children).toHaveLength(0);
    expect(test.controller.state().phase).toBe("idle");
  });
  it("reports a crashed child and can restart the same retained profile", async () => {
    const test = await setup();
    await test.controller.start();
    test.children[0]!.emit("exit", 1);
    expect(test.controller.state().phase).toBe("failed");
    expect(await test.controller.matchesDesiredStack()).toBe(false);
    await test.controller.start();
    expect(test.children).toHaveLength(2);
    expect(test.controller.state().phase).toBe("ready");
  });
});
