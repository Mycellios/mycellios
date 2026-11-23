import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseNodeConfiguration, type NodeConfiguration } from "../contracts/node-configuration.js";
import { resolveActiveComponentRoot } from "../update/component-update-manager.js";
import {
  componentStorageRoot,
  NODE_MANAGED_COMPONENT_IDS,
  NodeComponentLifecycle,
  nodeAppEntrypoint,
} from "./component-lifecycle.js";
import { effectiveComponentUpdates } from "./update-trust.js";

/** Boot-health window for a newly activated node-app (specs/node-runtime-auto-update). */
export const NODE_APP_HEALTH_DEADLINE_MS = 10 * 60_000;
/** Set by the bundled supervisor so a component knows its bootstrap. */
export const NODE_BOOTSTRAP_ROOT_ENV = "MYCELLIOS_NODE_BOOTSTRAP_ROOT";

export interface NodeAppLaunch {
  source: "bundled" | "component";
  entrypoint: string;
  cwd: string;
  /** True when this launch must prove boot health or be rolled back. */
  pendingActivation: boolean;
}

export interface NodeAppLaunchInput {
  supervisorDirectory: string;
  configPath: string | undefined;
  forceBundled?: boolean;
}

export function bundledNodeAppLaunch(supervisorDirectory: string): NodeAppLaunch {
  return {
    source: "bundled",
    entrypoint: join(supervisorDirectory, "main.js"),
    cwd: join(supervisorDirectory, "..", ".."),
    pendingActivation: false,
  };
}

/**
 * Chooses the verified active node-app root, or the bundled app. Any doubt
 * (missing trust, untrusted key, modified files, missing entry point) falls
 * back to the bundled app installed by the owner; it never fails the service.
 */
export async function planNodeAppLaunch(input: NodeAppLaunchInput): Promise<NodeAppLaunch> {
  const bundled = bundledNodeAppLaunch(input.supervisorDirectory);
  if (input.forceBundled || !input.configPath) return bundled;
  const lifecycle = await supervisedLifecycle(input.configPath, bundled.cwd);
  if (!lifecycle) return bundled;
  const { config } = lifecycle;
  const keys = config.componentUpdates?.pinnedKeys[config.updateChannel] ?? [];
  if (keys.length === 0) return bundled;
  const root = await resolveActiveComponentRoot(componentStorageRoot(config), "node-app", config.updateChannel, keys);
  if (!root) return bundled;
  const entrypoint = nodeAppEntrypoint(root);
  try {
    const info = await lstat(entrypoint);
    if (!info.isFile() || info.isSymbolicLink()) return bundled;
  } catch {
    return bundled;
  }
  const pending = await lifecycle.lifecycle.pendingActivation().catch(() => null);
  const pendingActivation = pending?.changedComponents.includes("node-app") === true
    && await lifecycle.lifecycle.pendingActivationIsCurrent().catch(() => false);
  return { source: "component", entrypoint, cwd: root, pendingActivation };
}

/** True while a node-app activation still waits for its boot-health marker. */
export async function nodeAppActivationPending(configPath: string, bootstrapRoot: string): Promise<boolean> {
  const loaded = await supervisedLifecycle(configPath, bootstrapRoot);
  if (!loaded) return false;
  const pending = await loaded.lifecycle.pendingActivation();
  return pending?.changedComponents.includes("node-app") === true
    && await loaded.lifecycle.pendingActivationIsCurrent();
}

/**
 * Restores the last verified node-app (or the bundled app) after the candidate
 * exited or stayed unhealthy before marking itself healthy. Returns false when
 * nothing was pending (the candidate already recovered or was healthy).
 */
export async function rollbackUnhealthyNodeApp(configPath: string, bootstrapRoot: string): Promise<boolean> {
  const loaded = await supervisedLifecycle(configPath, bootstrapRoot);
  if (!loaded) return false;
  if (!await nodeAppActivationPending(configPath, bootstrapRoot)) return false;
  await loaded.lifecycle.rollbackFailedActivation();
  return true;
}

async function supervisedLifecycle(
  configPath: string,
  bootstrapRoot: string,
): Promise<{ config: NodeConfiguration; lifecycle: NodeComponentLifecycle } | null> {
  let config: NodeConfiguration;
  try {
    config = parseNodeConfiguration(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    return null;
  }
  const componentUpdates = await effectiveComponentUpdates(config, bootstrapRoot).catch(() => undefined);
  if (!componentUpdates) return null;
  const effective = { ...config, componentUpdates };
  const version = await bootstrapVersion(bootstrapRoot);
  return {
    config: effective,
    lifecycle: new NodeComponentLifecycle(
      effective, version, async () => true, async () => async () => undefined, fetch, undefined, undefined,
      NODE_MANAGED_COMPONENT_IDS,
    ),
  };
}

export async function bootstrapVersion(bootstrapRoot: string): Promise<string> {
  const document = JSON.parse(await readFile(join(bootstrapRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof document.version !== "string" || !document.version.trim()) throw new Error("mycellios_node_bootstrap_version_invalid");
  return document.version;
}
