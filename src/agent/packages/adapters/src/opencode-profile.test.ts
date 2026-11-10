import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareOpenCodeProfile } from "./opencode-profile.js";

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
