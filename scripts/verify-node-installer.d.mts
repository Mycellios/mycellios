import type { NodeInstallerLayoutManifest } from "./stage-node-installer.mjs";
export function verifyNodeInstaller(root: string, options?: { trustedServiceWrapperSha256?: string }): Promise<NodeInstallerLayoutManifest>;
