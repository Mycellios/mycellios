import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalAppJson, type AppManifest } from "./app-manifest.js";
import { validateAppManifest, validateAppVersionChange } from "./app-validation.js";

const template = JSON.parse(readFileSync(new URL("../../../skills/create-mycellios-app/assets/template/app.json", import.meta.url), "utf8"));
const fresh = (): AppManifest => structuredClone(template);

it("admits the complete video studio's typed, review-gated local/Cloud definition", () => {
  expect(validateAppManifest(fresh())).toMatchObject({ ok: true });
});

const invalid: Array<[string, (app: any) => void]> = [
  ["an embedded login", app => { app.session = "custom-login"; }],
  ["arbitrary HTML", app => { app.screens[0].blocks[0] = { id: "injected", component: "html", html: "<script>steal()</script>" }; }],
  ["an event handler hidden in a known block", app => { app.screens[0].blocks[0].onclick = "steal()"; }],
  ["an unregistered shell action", app => { app.workflow.steps[0].action = "computer.shell"; }],
  ["an unsupported action version", app => { app.workflow.steps[0].actionVersion = "2.0.0"; }],
  ["missing required permissions", app => { app.permissions = ["media.voice", "media.render"]; }],
  ["unused capability expansion", app => { app.workflow.steps = [app.workflow.steps[0]]; app.screens = [app.screens[0], app.screens[1]]; }],
  ["a dependency cycle", app => { app.workflow.steps[1].dependsOn = ["render"]; }],
  ["an unknown dependency", app => { app.workflow.steps[1].dependsOn = ["missing"]; }],
  ["a disconnected step", app => { app.workflow.steps[1].dependsOn = []; }],
  ["a nonexistent entry", app => { app.workflow.entry = "missing"; }],
  ["duplicate steps", app => { app.workflow.steps.push(structuredClone(app.workflow.steps[0])); }],
  ["an output read before its producer", app => { app.workflow.steps[0].bindings.prompt = { source: "step", step: "voice", output: "audio" }; }],
  ["an image used as a voice", app => { app.workflow.steps[5].bindings.voice = { source: "step", step: "preview", output: "image" }; }],
  ["a nonexistent action output", app => { app.workflow.steps[1].bindings.text.output = "missing"; }],
  ["a missing action input", app => { app.workflow.steps[0].bindings = {}; }],
  ["a hidden required input", app => { app.screens[0].blocks = [app.screens[0].blocks[0]]; }],
  ["a hidden review", app => { app.screens[2].blocks.pop(); }],
  ["approval from an ordinary task", app => { app.workflow.steps[5].approvalStep = "script"; }],
  ["a review without its producer dependency", app => { app.workflow.steps[4].dependsOn = ["script"]; }],
  ["an undeclared target", app => { app.execution.environments = [app.execution.environments[0]]; }],
  ["paid fallback without consent", app => { app.execution.cloudFallback = "automatic"; }],
  ["automatic effect replay", app => { app.workflow.steps[0].automaticRetries = 1; }],
  ["fractional monetary microunits", app => { app.billing.maxMicrounitsPerRun = 0.5; }],
  ["negative resources", app => { app.execution.environments[0].memoryMb = -1; }],
  ["an inline secret field", app => { app.credentials = { token: "never-include-this" }; }],
  ["mutable project upgrades", app => { app.updates.existingProjects = "latest"; }],
  ["a missing instruction asset", app => { app.workflow.steps[0].instructions = ["missing"]; }],
];
it.each(invalid)("rejects %s", (_name, mutate) => {
  const app = fresh();
  mutate(app);
  expect(validateAppManifest(app).ok).toBe(false);
});

it.each(["../outside.md", "prompts/../../outside.md", "prompts/./a.md", "prompts//a.md", "C:/secret.md", "prompts\\a.md", "prompts/%2e%2e/a.md", "prompts/CON.md", "prompts/a./b.md", "prompts/a.js"])("rejects nonportable or executable asset paths: %s", path => {
  const app = fresh(); app.assets[0]!.path = path;
  expect(validateAppManifest(app).ok).toBe(false);
});

it("rejects case-colliding paths across Linux and Windows", () => {
  const app = fresh(); app.assets[1]!.path = app.assets[0]!.path.replace("studio", "Studio");
  expect(validateAppManifest(app).ok).toBe(false);
});

it("enforces immutable versions independently of JSON key order", () => {
  const original = fresh();
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as AppManifest;
  expect(canonicalAppJson(reordered)).toBe(canonicalAppJson(original));
  expect(validateAppVersionChange(original, reordered)).toEqual([]);
  const changed = fresh(); changed.name = "Changed interface";
  expect(validateAppVersionChange(original, changed)).not.toEqual([]);
  changed.version = "1.0.1";
  expect(validateAppVersionChange(original, changed)).toEqual([]);
});

it("rejects identity changes and rollbacks while comparing versions numerically", () => {
  const prior = fresh(); prior.version = "1.10.0";
  const next = fresh(); next.version = "1.9.99";
  expect(validateAppVersionChange(prior, next)).not.toEqual([]);
  next.version = "2.0.0";
  expect(validateAppVersionChange(prior, next)).toEqual([]);
  next.id = "io.example.different";
  expect(validateAppVersionChange(prior, next)).not.toEqual([]);
});
