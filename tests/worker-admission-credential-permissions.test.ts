import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateWorkerAdmissionCredential,
  loadOrCreateWorkerAdmissionCredential,
  restrictToOwner,
} from "../src/worker/admission-credential.js";

const directories: string[] = [];
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "mycellios-worker-key-"));
  directories.push(root);
  return root;
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("worker admission credential file permissions", () => {
  it.skipIf(process.platform === "win32")("narrows an existing world-readable key to its owner", () => {
    const path = join(directory(), "worker-admission-credential.json");
    const credential = generateWorkerAdmissionCredential();
    writeFileSync(path, `${JSON.stringify(credential)}\n`);
    chmodSync(path, 0o644);
    expect(loadOrCreateWorkerAdmissionCredential(path)).toEqual(credential);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("creates new keys owner-only", () => {
    const path = join(directory(), "nested", "worker-admission-credential.json");
    loadOrCreateWorkerAdmissionCredential(path);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("leaves Windows ACLs and missing files untouched", () => {
    const path = join(directory(), "missing.json");
    expect(() => restrictToOwner(path, "linux")).not.toThrow();
    expect(() => restrictToOwner(path, "win32")).not.toThrow();
  });
});
