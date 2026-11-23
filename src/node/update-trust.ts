import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { nodeComponentUpdatesSchema, type NodeConfiguration } from "../contracts/node-configuration.js";

/**
 * Trust anchor for signed component updates, written by the native installer
 * build next to the bundled app (`<installRoot>/app/component-update-trust.json`).
 * It lets a runtime that was installed or upgraded by its owner receive later
 * verified updates without editing node.json. A trust block in node.json wins.
 * The anchor always comes from the bundled bootstrap, never from a component.
 */
export const NODE_COMPONENT_TRUST_FILE = "component-update-trust.json";
export const NODE_COMPONENT_TRUST_SCHEMA = "mycellios-node-component-trust/1" as const;

const trustDocumentSchema = z.object({
  schema: z.literal(NODE_COMPONENT_TRUST_SCHEMA),
  componentUpdates: nodeComponentUpdatesSchema,
}).strict();

export type NodeComponentUpdates = NonNullable<NodeConfiguration["componentUpdates"]>;

export async function readBundledComponentTrust(bootstrapRoot: string): Promise<NodeComponentUpdates | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(bootstrapRoot, "app", NODE_COMPONENT_TRUST_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("node_component_trust_unreadable", { cause: error });
  }
  if (raw.length > 16 * 1024) throw new Error("node_component_trust_too_large");
  try {
    return trustDocumentSchema.parse(JSON.parse(raw)).componentUpdates;
  } catch (error) {
    throw new Error("node_component_trust_invalid", { cause: error });
  }
}

export async function effectiveComponentUpdates(
  config: NodeConfiguration,
  bootstrapRoot: string,
): Promise<NodeComponentUpdates | undefined> {
  return config.componentUpdates ?? await readBundledComponentTrust(bootstrapRoot);
}

export function serializeNodeComponentTrust(componentUpdates: unknown): string {
  return `${JSON.stringify(trustDocumentSchema.parse({ schema: NODE_COMPONENT_TRUST_SCHEMA, componentUpdates }), null, 2)}\n`;
}
