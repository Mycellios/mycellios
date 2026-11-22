import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { MicoFolders, safeMicoFolderName } from "./mico-folders.js";

const key = (botId: string) => createHash("sha256").update(botId).digest("hex");

describe("safeMicoFolderName", () => {
  it("keeps ordinary names, including accents and emoji", () => {
    expect(safeMicoFolderName("Investigadora")).toBe("Investigadora");
    expect(safeMicoFolderName("Señora Mico 🍄")).toBe("Señora Mico 🍄");
  });

  it("removes characters that Windows, macOS or Linux refuse and path separators", () => {
    expect(safeMicoFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(safeMicoFolderName("../../etc")).toBe("etc");
    expect(safeMicoFolderName("tab\there\u0000")).toBe("tab here");
  });

  it("drops leading and trailing dots and spaces", () => {
    expect(safeMicoFolderName("  .hidden. . ")).toBe("hidden");
    expect(safeMicoFolderName("Writer...")).toBe("Writer");
  });

  it("never returns a Windows device name", () => {
    for (const name of ["CON", "nul", "Com1", "LPT9", "aux.txt", "COM¹"])
      expect(safeMicoFolderName(name)).toBe(`${name} Mico`);
    expect(safeMicoFolderName("Console")).toBe("Console");
  });

  it("falls back to a generic name and bounds the length", () => {
    expect(safeMicoFolderName(undefined)).toBe("Mico");
    expect(safeMicoFolderName(" ... ")).toBe("Mico");
    expect([...safeMicoFolderName("x".repeat(500))]).toHaveLength(60);
    expect(Buffer.byteLength(safeMicoFolderName("🍄".repeat(100)))).toBeLessThanOrEqual(160);
    expect(safeMicoFolderName(`${"a".repeat(59)}. b`)).toBe("a".repeat(59));
  });
});

describe("MicoFolders", () => {
  let root: string;
  let hiddenRoot: string;
  let visibleRoot: string;
  let stateFile: string;
  const create = () => new MicoFolders({ hiddenRoot, visibleRoot, stateFile });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-mico-folders-")));
    hiddenRoot = path.join(root, "computers", "desktop-computers");
    visibleRoot = path.join(root, "home", "Mycellios", "Micos");
    stateFile = path.join(root, "computers", "mico-folders.json");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("gives a new Mico a visible folder named after it and keeps it after a rename", () => {
    const folders = create();
    expect(folders.resolve(key("a"), "Writer")).toBe(path.join(visibleRoot, "Writer"));
    expect(folders.resolve(key("a"), "Renamed")).toBe(path.join(visibleRoot, "Writer"));
    expect(create().resolve(key("a"), "Renamed again")).toBe(path.join(visibleRoot, "Writer"));
    expect(create().existing(key("a"))).toBe(path.join(visibleRoot, "Writer"));
  });

  it("keeps an existing private home where it is", async () => {
    await mkdir(path.join(hiddenRoot, key("old")), { recursive: true });
    const folders = create();
    expect(folders.resolve(key("old"), "Writer")).toBe(path.join(hiddenRoot, key("old")));
    expect(folders.existing(key("old"))).toBe(path.join(hiddenRoot, key("old")));
    await expect(readFile(stateFile)).rejects.toThrow();
  });

  it("adds a short stable id when the name is taken by another Mico or an existing folder", async () => {
    const folders = create();
    expect(folders.resolve(key("a"), "Writer")).toBe(path.join(visibleRoot, "Writer"));
    const second = folders.resolve(key("b"), "writer");
    expect(second).toBe(
      path.join(
        visibleRoot,
        `writer ${createHash("sha256").update(key("b")).digest("hex").slice(0, 6)}`,
      ),
    );
    await mkdir(path.join(visibleRoot, "Notes"), { recursive: true });
    expect(folders.resolve(key("c"), "Notes")).not.toBe(path.join(visibleRoot, "Notes"));
    expect(create().resolve(key("b"))).toBe(second);
  });

  it("does not choose a folder for private-only keys or without a visible root", () => {
    expect(create().resolve(key("task"), "Task", true)).toBe(path.join(hiddenRoot, key("task")));
    expect(create().existing(key("task"))).toBeUndefined();
    const legacy = new MicoFolders({ hiddenRoot, stateFile });
    expect(legacy.resolve(key("a"), "Writer")).toBe(path.join(hiddenRoot, key("a")));
  });

  it("ignores saved entries that are not a plain folder name", async () => {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        version: 1,
        folders: { [key("a")]: "../outside", [key("b")]: "CON", [key("c")]: "Fine" },
      }),
    );
    const folders = create();
    expect(folders.existing(key("a"))).toBeUndefined();
    expect(folders.existing(key("b"))).toBeUndefined();
    expect(folders.existing(key("c"))).toBe(path.join(visibleRoot, "Fine"));
    expect(folders.resolve(key("a"), "Fine")).not.toBe(path.join(visibleRoot, "Fine"));
  });
});

describe("visible This PC folders over the host transport", () => {
  const token = "cd".repeat(32);
  const context = (botId: string, botName?: string) => ({
    operationId: "test",
    traceId: "test",
    spaceId: "test",
    userId: "test",
    botId,
    ...(botName ? { botName } : {}),
    signal: new AbortController().signal,
  });
  let root: string;
  let micoFolders: string;
  let server: Awaited<ReturnType<typeof startHostComputerServer>>;
  let client: HostComputerSandbox;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "mycellios-mico-host-")));
    micoFolders = path.join(root, "home", "Mycellios", "Micos");
    server = await startHostComputerServer({
      root: path.join(root, "computers"),
      token,
      hostname: "127.0.0.1",
      micoFolders,
    });
    client = new HostComputerSandbox(`http://127.0.0.1:${server.port}`, token);
    server.setEnabled(true);
  });
  afterEach(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  });

  it("creates a new Mico's files in its visible folder", async () => {
    const computer = await client.provision(
      { botId: "home-key", homePath: "" },
      context("mico-1", "Writer"),
    );
    await client.writeFile(
      computer,
      { path: "notes.txt", content: Buffer.from("hi") },
      context("mico-1"),
    );
    expect(await readFile(path.join(micoFolders, "Writer", "notes.txt"), "utf8")).toBe("hi");
    expect(server.micoFolder("mico-1")).toBe(path.join(micoFolders, "Writer"));
    expect(server.workspace("mico-1")).toBe(path.join(micoFolders, "Writer"));
    expect(server.micoFolder("mico-2")).toBeUndefined();
  });

  it("keeps a Mico that already has a private home in it", async () => {
    const hidden = path.join(root, "computers", "desktop-computers", key("mico-old"));
    await mkdir(hidden, { recursive: true });
    await writeFile(path.join(hidden, "kept.txt"), "kept");
    const computer = await client.provision(
      { botId: "home-key", homePath: "" },
      context("mico-old", "Writer"),
    );
    expect(
      new TextDecoder().decode(await client.readFile(computer, "kept.txt", context("mico-old"))),
    ).toBe("kept");
    expect(server.micoFolder("mico-old")).toBe(hidden);
    await expect(readdir(micoFolders)).rejects.toThrow();
  });
});
