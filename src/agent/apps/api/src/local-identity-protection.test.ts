import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isProtectedIdentity,
  LocalDataKeyUnavailableError,
  localIdentity,
  parseLocalDataKey,
  protectIdentity,
  unprotectIdentity,
} from "./local-identity-protection.js";

const directories: string[] = [];
async function dataDir() {
  const directory = await mkdtemp(join(tmpdir(), "mycellios-identity-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const key = randomBytes(32);

describe("local identity protection", () => {
  it("round-trips and refuses a wrong key or modified ciphertext", () => {
    const sealed = protectIdentity('{"a":"b"}', key);
    expect(isProtectedIdentity(sealed)).toBe(true);
    expect(sealed).not.toContain('"a"');
    expect(unprotectIdentity(sealed, key)).toBe('{"a":"b"}');
    expect(() => unprotectIdentity(sealed, randomBytes(32))).toThrow();
    const at = sealed.indexOf(":v1:") + 30;
    const tampered = `${sealed.slice(0, at)}${sealed[at] === "A" ? "B" : "A"}${sealed.slice(at + 1)}`;
    expect(() => unprotectIdentity(tampered, key)).toThrow();
    expect(() => unprotectIdentity(sealed, undefined)).toThrow(LocalDataKeyUnavailableError);
  });

  it("accepts only a 64-character lowercase hex key", () => {
    expect(parseLocalDataKey(key.toString("hex"))?.equals(key)).toBe(true);
    for (const value of [undefined, "", "ab", key.toString("hex").toUpperCase(), `${key.toString("hex")}0`])
      expect(parseLocalDataKey(value)).toBeUndefined();
  });

  it("creates a protected identity when a key is available", async () => {
    const directory = await dataDir();
    const created = await localIdentity(directory, key);
    const contents = await readFile(join(directory, "identity.json"), "utf8");
    expect(isProtectedIdentity(contents)).toBe(true);
    expect(contents).not.toContain(created.encryptionKey);
    expect(await localIdentity(directory, key)).toEqual(created);
  });

  it("keeps the plaintext format without a key", async () => {
    const directory = await dataDir();
    const created = await localIdentity(directory);
    expect(JSON.parse(await readFile(join(directory, "identity.json"), "utf8"))).toEqual(created);
  });

  it("protects an existing plaintext identity without changing it", async () => {
    const directory = await dataDir();
    const created = await localIdentity(directory);
    expect(await localIdentity(directory, key)).toEqual(created);
    expect(isProtectedIdentity(await readFile(join(directory, "identity.json"), "utf8"))).toBe(true);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await localIdentity(directory, key)).toEqual(created);
  });

  it("never replaces a protected identity it cannot open", async () => {
    const directory = await dataDir();
    await localIdentity(directory, key);
    const before = await readFile(join(directory, "identity.json"), "utf8");
    await expect(localIdentity(directory)).rejects.toThrow(LocalDataKeyUnavailableError);
    await expect(localIdentity(directory, randomBytes(32))).rejects.toThrow();
    expect(await readFile(join(directory, "identity.json"), "utf8")).toBe(before);
  });

  it("rejects a malformed identity instead of regenerating it", async () => {
    const directory = await dataDir();
    await writeFile(join(directory, "identity.json"), '{"encryptionKey":"short"}');
    await expect(localIdentity(directory, key)).rejects.toThrow("Invalid local identity");
  });
});
