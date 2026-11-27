import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeOpenCodeModels, openCodeModelProvider, prepareOpenCodeCatalogProfile, prepareOpenCodeProfile } from "./opencode-profile.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("uses the selected CLI provider with credentials in the actual XDG data path and excludes host extensions", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-profile-")); roots.push(root);
  const source = join(root, "source"), home = join(root, "isolated");
  await mkdir(join(source, ".config/opencode"), { recursive: true });
  await mkdir(join(source, ".local/share/opencode"), { recursive: true });
  await writeFile(join(source, ".config/opencode/opencode.json"), JSON.stringify({
    model: "example/chat", provider: { example: { models: { chat: {} } }, other: {} },
    plugin: ["untrusted-plugin"], mcp: { external: { command: ["untrusted"] } }, permission: { "*": "allow" },
  }));
  await writeFile(join(source, ".local/share/opencode/auth.json"), JSON.stringify({
    example: { type: "api", key: "fixture-secret" }, other: { type: "api", key: "unrelated-secret" },
  }));
  const config = await prepareOpenCodeProfile(home, source);
  expect(config).toEqual({ model: "example/chat", provider: { example: { models: { chat: {} } } },
    enabled_providers: ["example"], snapshot: false, permission: { "*": "deny", "rakazo_*": "allow" } });
  expect(JSON.parse(await readFile(join(home, "data/opencode/auth.json"), "utf8"))).toEqual({ example: { type: "api", key: "fixture-secret" } });
  expect(await readFile(join(home, "config/opencode/opencode.json"), "utf8")).toBe("{}");
  await writeFile(join(source, ".local/share/opencode/auth.json"), "{}");
  await prepareOpenCodeProfile(home, source);
  expect(await readFile(join(home, "data/opencode/auth.json"), "utf8")).toBe("{}");
});

it("retains the default provider with no host profile and fails malformed config without leaking it", async () => {
  const root = await mkdtemp(join(tmpdir(), "opencode-profile-")); roots.push(root);
  const source = join(root, "source");
  expect(await prepareOpenCodeProfile(join(root, "home"), source)).toMatchObject({ enabled_providers: ["opencode"] });
  await mkdir(join(source, ".config/opencode"), { recursive: true });
  await writeFile(join(source, ".config/opencode/opencode.json"), "fixture-private-invalid-json");
  await expect(prepareOpenCodeProfile(join(root, "home"), source)).rejects.toThrow("Could not read the native OpenCode provider configuration");
});

async function hostProfile() {
  const root = await mkdtemp(join(tmpdir(), "opencode-profile-")); roots.push(root);
  const source = join(root, "source");
  await mkdir(join(source, ".config/opencode"), { recursive: true });
  await mkdir(join(source, ".local/share/opencode"), { recursive: true });
  await writeFile(join(source, ".config/opencode/opencode.json"), JSON.stringify({
    model: "example/chat", provider: { example: { models: { chat: {} } }, custom: { npm: "fixture" } },
    plugin: ["untrusted-plugin"], mcp: { external: { command: ["untrusted"] } },
  }));
  await writeFile(join(source, ".local/share/opencode/auth.json"), JSON.stringify({
    example: { type: "api", key: "fixture-secret" }, google: { type: "api", key: "google-secret" },
  }));
  return { root, source };
}

it("runs the Mico's chosen model with only that provider's credentials and definition", async () => {
  const { root, source } = await hostProfile();
  const home = join(root, "isolated");
  expect(await prepareOpenCodeProfile(home, source, "google/gemini-3-pro")).toEqual({
    model: "google/gemini-3-pro", enabled_providers: ["google"], snapshot: false,
    permission: { "*": "deny", "rakazo_*": "allow" } });
  expect(JSON.parse(await readFile(join(home, "data/opencode/auth.json"), "utf8"))).toEqual({ google: { type: "api", key: "google-secret" } });
  expect(await prepareOpenCodeProfile(home, source, "custom/m")).toMatchObject({ provider: { custom: { npm: "fixture" } } });
  // A malformed choice falls back to the CLI's own model.
  expect(await prepareOpenCodeProfile(home, source, "no-provider")).toMatchObject({ model: "example/chat" });
});

it("lists models with every provider's credentials and definitions but no plugins or MCPs", async () => {
  const { root, source } = await hostProfile();
  const home = join(root, "catalog");
  expect(await prepareOpenCodeCatalogProfile(home, source)).toEqual({
    model: "example/chat", provider: { example: { models: { chat: {} } }, custom: { npm: "fixture" } },
    snapshot: false, permission: { "*": "deny" } });
  expect(Object.keys(JSON.parse(await readFile(join(home, "data/opencode/auth.json"), "utf8")))).toEqual(["example", "google"]);
  expect(await readFile(join(home, "config/opencode/opencode.json"), "utf8")).toBe("{}");
});

it("reads opencode's verbose catalog, keeping tool-capable models with the CLI's own first", () => {
  const entry = (id: string, extra: Record<string, unknown> = {}) => `${id}\n${JSON.stringify({
    id: id.split("/")[1], name: `Name ${id}`, status: "active", capabilities: { toolcall: true }, ...extra }, null, 2)}`;
  const output = [
    entry("google/gemini-3-pro"),
    entry("google/embed", { capabilities: { toolcall: false } }),
    entry("google/old", { status: "deprecated" }),
    entry("example/chat"),
    entry("google/gemini-3-pro"),
  ].join("\r\n") + "\n";
  expect(nativeOpenCodeModels(output, "example/chat")).toEqual([
    { id: "example/chat", label: "Name example/chat · example", isDefault: true, thinkingLevels: [], fast: false },
    { id: "google/gemini-3-pro", label: "Name google/gemini-3-pro · google", isDefault: false, thinkingLevels: [], fast: false },
  ]);
  expect(nativeOpenCodeModels("")).toEqual([]);
  expect(() => nativeOpenCodeModels("unexpected text")).toThrow("OpenCode model catalog unavailable.");
  expect(openCodeModelProvider("google/gemini-3-pro")).toBe("google");
  expect(openCodeModelProvider("bad id/x")).toBeUndefined();
});
