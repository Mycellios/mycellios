import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { checkAppUpdate, validateAppBundle } from "../../../scripts/apps/bundle.js";

const agent = fileURLToPath(new URL("../../../", import.meta.url));
const template = resolve(agent, "skills/create-mycellios-app/assets/template");
const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !/^mycellios-app-(test|outside)-/.test(basename(dir))) throw Error("Unsafe test cleanup target");
    rmSync(dir, { recursive: true, force: true });
  }
});
function copy() {
  const dir = mkdtempSync(join(tmpdir(), "mycellios-app-test-")); temporary.push(dir);
  cpSync(template, dir, { recursive: true });
  return join(dir, "app.json");
}
function edit(file: string, mutate: (app: any) => void) {
  const app = JSON.parse(readFileSync(file, "utf8")); mutate(app);
  writeFileSync(file, JSON.stringify(app));
}
function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/apps/validate.ts", ...args], {
    cwd: agent, encoding: "utf8", timeout: 30_000, env: { ...process.env, NODE_OPTIONS: "" },
  });
}

it("validates actual template files and canonical identity without executing them", async () => {
  const checked = await validateAppBundle(join(template, "app.json"));
  expect(checked.ok).toBe(true);
  const copied = copy();
  expect(await validateAppBundle(copied)).toEqual(checked);
});

it("detects a changed skill even when the definition remains unchanged", async () => {
  const file = copy();
  writeFileSync(join(dirname(file), "skills/protocol.md"), "Changed procedure");
  expect(await validateAppBundle(file)).toMatchObject({ ok: false, issues: [{ path: "assets.project-protocol" }] });
});

it("rejects missing and oversized resources", async () => {
  const file = copy();
  rmSync(join(dirname(file), "prompts/studio.md"));
  expect((await validateAppBundle(file)).ok).toBe(false);
  writeFileSync(join(dirname(file), "prompts/studio.md"), Buffer.alloc(8 * 1024 * 1024 + 1));
  expect((await validateAppBundle(file)).ok).toBe(false);
});

it("rejects a symlink escape even if its declared hash is correct", async () => {
  const file = copy();
  const outside = mkdtempSync(join(tmpdir(), "mycellios-app-outside-")); temporary.push(outside);
  writeFileSync(join(outside, "secret.md"), "outside scope");
  symlinkSync(outside, join(dirname(file), "prompts/linked"), "junction");
  edit(file, app => {
    app.assets[0].path = "prompts/linked/secret.md";
    app.assets[0].sha256 = createHash("sha256").update("outside scope").digest("hex");
  });
  expect(await validateAppBundle(file)).toMatchObject({ ok: false, issues: [{ message: "Asset resolves outside its bundle" }] });
});

it("bounds manifest parsing and does not echo invalid JSON contents", async () => {
  const file = copy();
  writeFileSync(file, "not-json-private-token-123");
  const result = cli([file, "--json"]);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("private-token-123");
  writeFileSync(file, " ".repeat(1024 * 1024 + 1));
  expect((await validateAppBundle(file)).ok).toBe(false);
});

it("checks prior bundle integrity as well as immutable-version rules", async () => {
  const previous = copy(), nextFile = copy();
  edit(nextFile, app => { app.name = "Updated app"; });
  const next = await validateAppBundle(nextFile);
  if (!next.ok) throw Error("Fixture invalid");
  expect(await checkAppUpdate(previous, next)).not.toEqual([]);
  writeFileSync(join(dirname(previous), "skills/protocol.md"), "corrupted previous version");
  expect(await checkAppUpdate(previous, next)).toMatchObject([{ path: "previous.assets.project-protocol" }]);
});

it("does not interpret terminal controls from hostile definition keys", () => {
  const file = copy();
  edit(file, app => { app.workflow.steps[0].bindings["bad\u001b[31m"] = { source: "input", field: "topic" }; });
  const result = cli([file]);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("\u001b");
  expect(result.stderr).toContain("\\u001b");
});

it("CLI exposes limits honestly and validates updates with meaningful exit codes", () => {
  const previous = copy(), next = copy();
  const result = cli([next, "--json"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, runtimeQualification: "not-run", authorization: "not-run", publication: "not-run" });
  edit(next, app => { app.description = "Changed"; });
  expect(cli([next, "--previous", previous, "--json"]).status).toBe(1);
  edit(next, app => { app.version = "1.0.1"; });
  expect(cli([next, "--previous", previous, "--json"]).status).toBe(0);
  expect(cli(["--unknown"]).status).toBe(2);
});

it("exports structural JSON Schema without suggesting it includes semantic checks", () => {
  const result = cli(["--schema"]);
  expect(result.status, result.stderr).toBe(0);
  const schema = JSON.parse(result.stdout);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.schemaVersion.const).toBe("mycellios.app/1");
});
