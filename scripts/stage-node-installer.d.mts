export const NODE_INSTALLER_LAYOUT_SCHEMA: "mycellios-node-installer-layout/2";
import type { NativeBuildProvenance } from "./native-build-provenance.mjs";
export interface StageNodeInstallerInput { output: string; dist: string; runtime: string; nodeExecutable: string; nodeModules: string; pythonSource: string; target: string; sourceRevision: string; sourceProvenance: NativeBuildProvenance; componentTrust?: NodeComponentTrustInput }
export interface NodeInstallerLayoutManifest { schema: typeof NODE_INSTALLER_LAYOUT_SCHEMA; target: string; sourceRevision: string; source: { revision: string; sourceId: `sha256:${string}`; provenanceSha256: string; version: string }; toolchain: { nodeVersion: string; pythonVersion: string; pythonAbi: string; backend: string }; entrypoints: { service: string; install: string; uninstall: string; launcher: string }; runtimeManifestSha256: string; files: Array<{ path: string; bytes: number; sha256: string }> }
export function stageNodeInstaller(input: StageNodeInstallerInput): Promise<NodeInstallerLayoutManifest>;
export function inventoryNodeInstaller(root: string, excluded?: Set<string>): Promise<NodeInstallerLayoutManifest["files"]>;
export interface NodeComponentTrustInput { feedUrl: string; pinnedKeys: { dev: Array<{ keyId: string; spki: string }>; stable: Array<{ keyId: string; spki: string }> } }
export const NODE_COMPONENT_TRUST_FILE: "component-update-trust.json";
export function serializeComponentTrust(value: unknown): string;
export const NODE_APP_COMPONENT_SCHEMA: "mycellios-node-app-component/1";
export interface StageNodeAppInput { output: string; dist: string; nodeModules: string; pythonSource: string; sourceRevision: string; sourceProvenance: NativeBuildProvenance }
export interface NodeAppComponentStage { schema: typeof NODE_APP_COMPONENT_SCHEMA; sourceRevision: string; source: NodeInstallerLayoutManifest["source"]; files: NodeInstallerLayoutManifest["files"] }
export function stageNodeApp(input: StageNodeAppInput): Promise<NodeAppComponentStage>;
