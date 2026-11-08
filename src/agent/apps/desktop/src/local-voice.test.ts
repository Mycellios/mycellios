import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { LocalVoice } from "./local-voice.js";

vi.mock("./local-voice-models.json", () => ({ default: {
  asr: [{ name: "model.onnx", bytes: 3, url: "https://example.test/model", sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" }],
  tts: [],
} }));

it("refuses altered model downloads without exposing a ready engine", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mycellios-voice-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1,2,4]))));
  try {
    const voice = new LocalVoice(directory);
    await expect(voice.prepare()).rejects.toThrow("integrity");
    expect(voice.status()).toMatchObject({ready:false,preparing:false,error:expect.any(String)});
    await expect(voice.run({text:"Hello"})).rejects.toThrow("not ready");
  } finally {
    vi.unstubAllGlobals();
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
    await rm(directory, {recursive:true,force:true});
  }
});

it("recognizes verified models after restarting without downloading them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mycellios-voice-"));
  const fetchModel = vi.fn();
  vi.stubGlobal("fetch", fetchModel);
  try {
    await mkdir(path.join(directory, "asr"));
    await writeFile(path.join(directory, "asr", "model.onnx"), new Uint8Array([1, 2, 3]));
    const voice = new LocalVoice(directory);
    expect(voice.status().ready).toBe(false);
    expect(await voice.statusFromDisk()).toMatchObject({ ready: true, preparing: false, downloaded: 3, total: 3 });
    await voice.prepare();
    expect(fetchModel).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Unexpected cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});
