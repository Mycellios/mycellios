import { APP_ACTION_CONTRACTS, type AppValueType } from "./app-actions.js";
import { AppManifestSchema, canonicalAppJson, type AppManifest } from "./app-manifest.js";

export type AppValidationIssue = { path: string; message: string };
export type AppValidation = { ok: true; manifest: AppManifest } | { ok: false; issues: AppValidationIssue[] };

/** Definition admission only. Does not execute tools, grant access or certify a runtime. */
export function validateAppManifest(value: unknown): AppValidation {
  const parsed = AppManifestSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(issue => ({
    path: issue.path.join("."), message: issue.message,
  })) };
  const app = parsed.data;
  const issues: AppValidationIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  function unique(values: readonly string[], path: string) {
    if (new Set(values).size !== values.length) fail(path, "Duplicate identifier or value");
  }
  unique(app.permissions, "permissions");
  unique(app.inputs.map(field => field.id), "inputs");
  unique(app.assets.map(asset => asset.id), "assets");
  unique(app.assets.map(asset => asset.path.toLowerCase()), "assets.path");
  unique(app.screens.map(screen => screen.id), "screens");
  unique(app.workflow.steps.map(step => step.id), "workflow.steps");
  unique(app.execution.environments.map(env => env.target), "execution.environments");
  for (const field of app.inputs) {
    if (field.type === "number" && field.min > field.max) fail(`inputs.${field.id}`, "min exceeds max");
    if (field.type === "choice") unique(field.options, `inputs.${field.id}.options`);
    if (field.type === "artifact") unique(field.mediaTypes, `inputs.${field.id}.mediaTypes`);
  }
  const steps = new Map(app.workflow.steps.map(step => [step.id, step]));
  const inputs = new Map(app.inputs.map(field => [field.id, field]));
  const assets = new Map(app.assets.map(asset => [asset.id, asset]));
  const targets = new Set(app.execution.environments.map(env => env.target));
  if (!steps.has(app.workflow.entry)) fail("workflow.entry", "Unknown entry step");
  for (const step of app.workflow.steps) {
    unique(step.dependsOn, `workflow.${step.id}.dependsOn`);
    if (step.id === app.workflow.entry && step.dependsOn.length) fail(`workflow.${step.id}`, "Entry must have no dependencies");
    if (step.id !== app.workflow.entry && !step.dependsOn.length) fail(`workflow.${step.id}`, "Only the entry may have no dependencies");
    for (const dependency of step.dependsOn) {
      if (!steps.has(dependency)) fail(`workflow.${step.id}.dependsOn`, "Unknown dependency");
    }
  }
  const ancestors = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  function collect(id: string): Set<string> {
    const known = ancestors.get(id);
    if (known) return known;
    if (visiting.has(id)) { fail(`workflow.${id}`, "Dependency cycle"); return new Set(); }
    visiting.add(id);
    const found = new Set<string>();
    for (const dep of steps.get(id)?.dependsOn ?? []) {
      found.add(dep);
      for (const predecessor of collect(dep)) found.add(predecessor);
    }
    visiting.delete(id);
    ancestors.set(id, found);
    return found;
  }
  for (const step of app.workflow.steps) collect(step.id);
  function outputType(ref: { step: string; output: string }, path: string): AppValueType | undefined {
    const producer = steps.get(ref.step);
    if (!producer || producer.kind !== "task") { fail(path, "Output must belong to a task"); return; }
    const outputs: Readonly<Record<string, AppValueType>> = APP_ACTION_CONTRACTS[producer.action].outputs;
    const type = Object.hasOwn(outputs, ref.output) ? outputs[ref.output] : undefined;
    if (!type) fail(path, "Unknown action output");
    return type;
  }
  const usedCapabilities = new Set<string>();
  for (const step of app.workflow.steps) {
    const before = ancestors.get(step.id)!;
    if (step.id !== app.workflow.entry && !before.has(app.workflow.entry)) fail(`workflow.${step.id}`, "Step is not reachable from entry");
    if (step.kind === "review") {
      if (!before.has(step.artifact.step)) fail(`workflow.${step.id}.artifact`, "Review must depend on its artifact producer");
      if (!["image", "audio", "video", "document"].includes(outputType(step.artifact, `workflow.${step.id}.artifact`) ?? "")) fail(`workflow.${step.id}.artifact`, "Review requires an artifact");
      continue;
    }
    const contract = APP_ACTION_CONTRACTS[step.action];
    usedCapabilities.add(contract.capability);
    if (step.actionVersion !== contract.version) fail(`workflow.${step.id}.actionVersion`, "Unsupported action contract version");
    if (!app.permissions.includes(contract.capability)) fail(`workflow.${step.id}`, "Required capability was not declared");
    unique(step.targets, `workflow.${step.id}.targets`);
    for (const destination of step.targets) if (!targets.has(destination)) fail(`workflow.${step.id}.targets`, "Undeclared execution target");
    unique(step.instructions, `workflow.${step.id}.instructions`);
    for (const assetId of step.instructions) {
      const asset = assets.get(assetId);
      if (!asset || !/\.(md|txt)$/.test(asset.path)) fail(`workflow.${step.id}.instructions`, "Instructions must reference a bundled text asset");
    }
    if (step.approvalStep) {
      if (!before.has(step.approvalStep) || steps.get(step.approvalStep)?.kind !== "review") fail(`workflow.${step.id}.approvalStep`, "Approval must reference an ancestor review");
    }
    const expected: Readonly<Record<string, AppValueType>> = contract.inputs;
    if (Object.keys(expected).sort().join(",") !== Object.keys(step.bindings).sort().join(",")) fail(`workflow.${step.id}.bindings`, "Bindings must match the action input contract");
    for (const [name, binding] of Object.entries(step.bindings)) {
      let actual: AppValueType | undefined;
      if (binding.source === "input") {
        const field = inputs.get(binding.field);
        if (!field) fail(`workflow.${step.id}.bindings.${name}`, "Unknown input field");
        else {
          if (field.type === "artifact") {
            if (field.mediaTypes.length !== 1) fail(`workflow.${step.id}.bindings.${name}`, "Task artifact inputs require exactly one media type");
            actual = field.mediaTypes[0];
          } else actual = field.type === "choice" ? "text" : field.type;
          if (!field.required) fail(`workflow.${step.id}.bindings.${name}`, "Task inputs require a required field in v1");
        }
      } else {
        if (!before.has(binding.step)) fail(`workflow.${step.id}.bindings.${name}`, "Binding must reference an ancestor task");
        actual = outputType(binding, `workflow.${step.id}.bindings.${name}`);
      }
      if (actual && actual !== expected[name]) fail(`workflow.${step.id}.bindings.${name}`, "Binding type does not match action input");
    }
  }
  for (const permission of app.permissions) if (!usedCapabilities.has(permission)) fail("permissions", "Unused capability");
  const visibleInputs = new Set<string>();
  const visibleReviews = new Set<string>();
  for (const screen of app.screens) {
    unique(screen.blocks.map(block => block.id), `screens.${screen.id}.blocks`);
    for (const block of screen.blocks) {
      const path = `screens.${screen.id}.${block.id}`;
      if (block.component === "field") {
        if (!inputs.has(block.field)) fail(path, "Unknown input field");
        visibleInputs.add(block.field);
      } else if (block.component === "step" || block.component === "review") {
        const step = steps.get(block.step);
        if (!step || (block.component === "review" && step.kind !== "review")) fail(path, "Unknown or incompatible step");
        if (block.component === "review") visibleReviews.add(block.step);
      } else if (block.component === "result") outputType(block, path);
    }
  }
  for (const field of app.inputs) if (!visibleInputs.has(field.id)) fail("screens", "Every input must be visible");
  for (const step of app.workflow.steps) if (step.kind === "review" && !visibleReviews.has(step.id)) fail("screens", "Every review must have a review component");
  return issues.length ? { ok: false, issues } : { ok: true, manifest: app };
}

export function validateAppVersionChange(previous: AppManifest, next: AppManifest): AppValidationIssue[] {
  if (previous.id !== next.id) return [{ path: "id", message: "An update must retain its app ID" }];
  if (previous.version === next.version) return canonicalAppJson(previous) === canonicalAppJson(next) ? []
    : [{ path: "version", message: "Published versions are immutable; use a new version" }];
  const oldParts = previous.version.split(".").map(Number), newParts = next.version.split(".").map(Number);
  const changed = newParts.findIndex((part, i) => part !== oldParts[i]);
  return changed >= 0 && newParts[changed]! > oldParts[changed]! ? []
    : [{ path: "version", message: "Version must increase" }];
}
