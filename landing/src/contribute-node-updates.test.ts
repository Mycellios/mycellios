import { describe, expect, it } from "vitest";
import { nodeAutoUpdateSummary, nodeUpdateReadiness } from "./Contribute";
import type { OwnedNode } from "./api-access";

const base = {
  nodeId: "node-1", status: "active", generation: 1, credentialFingerprint: "f", connected: true, workerId: null, desired: null, commands: [],
} as const;

function node(updates: unknown): OwnedNode {
  return { ...base, observed: { updates } as unknown as OwnedNode["observed"] } as unknown as OwnedNode;
}

describe("native node runtime updates", () => {
  it("tells the owner when one manual runtime update is still required", () => {
    expect(nodeUpdateReadiness({ ...base, observed: null } as unknown as OwnedNode)).toBeNull();
    expect(nodeUpdateReadiness(node(undefined))).toMatch(/one manual runtime update/);
    expect(nodeUpdateReadiness(node({ capable: false }))).toMatch(/no signed update trust/);
    expect(nodeUpdateReadiness(node({ capable: true, activeManifestId: `sha256:${"a".repeat(64)}` }))).toBe("Verified runtime aaaaaaaaaaaa");
    expect(nodeUpdateReadiness(node({ capable: true, activeManifestId: null }))).toMatch(/ready for verified updates/);
  });

  it("states the owner-only, verified and reversible policy", () => {
    expect(nodeAutoUpdateSummary(null)).toBe("Loading…");
    const summary = nodeAutoUpdateSummary({ schema: "mycellios-node-auto-update/1", enabled: false, channel: "stable", available: false, updatedAt: null });
    expect(summary).toMatch(/Only your own devices/);
    expect(summary).toMatch(/No verified release is published yet/);
  });
});
