import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listWhatsAppLinkFiles,
  openWhatsAppState,
  sealWhatsAppState,
  WhatsAppAuthFile,
} from "./auth-store.js";
import { runtime } from "./baileys-runtime.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const temp = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wa-auth-"));
  dirs.push(dir);
  return dir;
};
const meta = (localId: string) => ({
  localId,
  botId: "bot",
  mode: "personal" as const,
  base: "https://example.test",
  userId: "user",
});

describe("WhatsApp encrypted auth state", () => {
  it("round-trips creds, signal keys and sent ids without plaintext on disk", async () => {
    const dir = await temp();
    const key = randomBytes(32);
    const localId = randomUUID();
    const auth = await WhatsAppAuthFile.create(dir, key, runtime, meta(localId));
    const preKey = {
      public: Buffer.from("pub-key-bytes"),
      private: Buffer.from("very-secret-private-key"),
    };
    await auth.state.keys.set({
      "pre-key": { "1": preKey },
      session: { "a.0": Buffer.from("session") },
    });
    auth.rememberSent("SENT1");
    await auth.updateMeta({ linkId: "link-1", phone: "34600000001" });

    const file = WhatsAppAuthFile.path(dir, localId);
    const raw = await readFile(file, "utf8");
    expect(raw.startsWith("mwa1.")).toBe(true);
    expect(raw).not.toContain("very-secret");
    expect(Buffer.from(raw.slice(5), "base64").toString("latin1")).not.toContain("very-secret");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0);
    expect(await listWhatsAppLinkFiles(dir)).toEqual([localId]);

    const reopened = (await WhatsAppAuthFile.open(dir, key, runtime, localId))!;
    expect(reopened.meta).toMatchObject({ linkId: "link-1", phone: "34600000001", botId: "bot" });
    expect(reopened.state.creds.noiseKey.private).toEqual(auth.state.creds.noiseKey.private);
    const stored = await reopened.state.keys.get("pre-key", ["1", "2"]);
    expect(Buffer.from(stored["1"]!.private)).toEqual(preKey.private);
    expect(stored["2"]).toBeUndefined();
    expect(reopened.sentIds().has("SENT1")).toBe(true);

    await reopened.state.keys.set({ "pre-key": { "1": null } });
    expect(
      (
        await (await WhatsAppAuthFile.open(dir, key, runtime, localId))!.state.keys.get("pre-key", [
          "1",
        ])
      )["1"],
    ).toBeUndefined();

    await reopened.remove();
    expect(await listWhatsAppLinkFiles(dir)).toEqual([]);
    expect(await WhatsAppAuthFile.open(dir, key, runtime, localId)).toBeNull();
  });

  it("rejects a modified file, the wrong key and a file moved to another link", async () => {
    const dir = await temp();
    const key = randomBytes(32);
    const localId = randomUUID();
    await WhatsAppAuthFile.create(dir, key, runtime, meta(localId));
    const file = WhatsAppAuthFile.path(dir, localId);
    const sealed = await readFile(file, "utf8");
    const bytes = Buffer.from(sealed.slice(5), "base64");
    bytes[bytes.length - 1]! ^= 1;
    await writeFile(file, "mwa1." + bytes.toString("base64"));
    await expect(WhatsAppAuthFile.open(dir, key, runtime, localId)).rejects.toThrow();

    expect(() => openWhatsAppState(randomBytes(32), localId, sealed)).toThrow();
    expect(() => openWhatsAppState(key, randomUUID(), sealed)).toThrow();
    expect(openWhatsAppState(key, localId, sealWhatsAppState(key, localId, "{}"))).toBe("{}");
  });

  it("keeps only the most recent 5000 sent ids", async () => {
    const dir = await temp();
    const auth = await WhatsAppAuthFile.create(dir, randomBytes(32), runtime, meta(randomUUID()));
    for (let index = 0; index < 5_010; index++) auth.rememberSent(`ID${index}`);
    expect(auth.sentIds().size).toBe(5_000);
    expect(auth.sentIds().has("ID0")).toBe(false);
    expect(auth.sentIds().has("ID5009")).toBe(true);
    await auth.save();
  });
});
