import * as z from "zod";
import { APP_ACTION_IDS, APP_CAPABILITIES } from "./app-actions.js";

const id = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/)
  .refine(value => !["constructor", "prototype"].includes(value), "Reserved identifier");
export const AppVersionSchema = z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const label = z.string().trim().min(1).max(160);
const target = z.enum(["local", "cloud"]);
const outputRef = z.strictObject({ step: id, output: id });
const binding = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("input"), field: id }),
  z.strictObject({ source: z.literal("step"), ...outputRef.shape }),
]);
const commonField = { id, label, required: z.boolean() };
export const AppInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...commonField, type: z.literal("text"), maxLength: z.number().int().min(1).max(100_000) }),
  z.strictObject({ ...commonField, type: z.literal("number"), min: z.number().finite(), max: z.number().finite() }),
  z.strictObject({ ...commonField, type: z.literal("boolean") }),
  z.strictObject({ ...commonField, type: z.literal("choice"), options: z.array(label).min(1).max(50) }),
  z.strictObject({ ...commonField, type: z.literal("artifact"), mediaTypes: z.array(z.enum(["image", "audio", "video", "document"])).min(1).max(4) }),
]);
const commonStep = { id, title: label, dependsOn: z.array(id).max(64) };
export const AppStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonStep, kind: z.literal("task"), action: z.enum(APP_ACTION_IDS), actionVersion: AppVersionSchema,
    targets: z.array(target).min(1).max(2),
    bindings: z.record(id, binding), instructions: z.array(id).min(1).max(16),
    approvalStep: id.optional(), recovery: z.literal("reconcile-before-retry"),
    automaticRetries: z.literal(0),
  }),
  z.strictObject({
    ...commonStep, kind: z.literal("review"), artifact: outputRef,
    approvalBinding: z.literal("artifact-and-source-revision"),
  }),
]);
const block = z.discriminatedUnion("component", [
  z.strictObject({ id, component: z.literal("text"), text: z.string().max(4000) }),
  z.strictObject({ id, component: z.literal("field"), field: id }),
  z.strictObject({ id, component: z.literal("step"), step: id }),
  z.strictObject({ id, component: z.literal("review"), step: id }),
  z.strictObject({ id, component: z.literal("result"), ...outputRef.shape }),
]);
const environment = z.strictObject({
  target, cpuCores: z.number().int().min(1).max(64), memoryMb: z.number().int().min(128).max(1_048_576),
  gpuRequired: z.boolean(), maxSeconds: z.number().int().min(1).max(86_400),
});
const assetPath = z.string().max(240).regex(/^(assets|prompts|skills)\/[a-zA-Z0-9._/-]+$/)
  .refine(value => value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "Unsafe asset path")
  .refine(value => value.split("/").every(part => !part.endsWith(".") && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), "Nonportable asset path")
  .refine(value => /\.(md|txt|json|png|webp)$/.test(value), "Unsupported bundled asset type");

/** Strict structure; validateAppManifest adds graph, binding and catalog checks. */
export const AppManifestSchema = z.strictObject({
  schemaVersion: z.literal("mycellios.app/1"),
  id: z.string().max(160).regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/),
  version: AppVersionSchema, name: label, description: z.string().trim().min(1).max(2000),
  author: z.strictObject({ name: label }), visibility: z.enum(["private", "unlisted", "public"]),
  session: z.literal("mycellios"),
  permissions: z.array(z.enum(APP_CAPABILITIES)).max(APP_CAPABILITIES.length),
  assets: z.array(z.strictObject({
    id, path: assetPath, sha256: z.string().regex(/^[a-f0-9]{64}$/).refine(value => !/^0+$/.test(value), "Empty digest"),
  })).min(1).max(64),
  inputs: z.array(AppInputSchema).max(40),
  workflow: z.strictObject({ entry: id, steps: z.array(AppStepSchema).min(1).max(64) }),
  screens: z.array(z.strictObject({ id, title: label, blocks: z.array(block).min(1).max(50) })).min(1).max(20),
  persistence: z.strictObject({
    scope: z.literal("user-space-project"), schemaVersion: AppVersionSchema,
    artifacts: z.literal("private-references"),
  }),
  updates: z.strictObject({ existingProjects: z.literal("pinned"), newVersions: z.literal("new-projects-only") }),
  execution: z.strictObject({
    runtimeProtocol: z.literal("mycellios.app-runtime/1"), selection: z.literal("user-selected"),
    environments: z.array(environment).min(1).max(2),
    cloudFallback: z.literal("explicit-consent"), artifactTransfer: z.literal("explicit-consent"),
    unavailableExecutor: z.literal("wait"), maxParallelSteps: z.number().int().min(1).max(4),
  }),
  billing: z.strictObject({
    currency: z.literal("credits"), maxMicrounitsPerRun: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    requireQuote: z.literal(true), modelTokens: z.literal("actual-usage"),
    cloudCompute: z.literal("actual-usage"), uncertainUsage: z.literal("pending"),
  }),
});
export type AppManifest = z.infer<typeof AppManifestSchema>;
export type AppStep = z.infer<typeof AppStepSchema>;

/** Canonical JSON for content identity; arrays retain meaningful order. */
export function canonicalAppJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAppJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalAppJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
