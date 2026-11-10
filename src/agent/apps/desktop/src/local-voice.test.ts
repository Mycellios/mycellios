import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalVoice, requireVoiceModelKind } from "./local-voice.js";

vi.mock("./local-voice-models.json", () => {
  const file = {
    name: "model.onnx",
    bytes: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  };
  return {
    default: {
      asr: [{ ...file, url: "https://models.example/asr" }],
      tts: [{ ...file, url: "https://models.example/tts" }],
    },
  };
});

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
  directory = undefined;
});

it("refuses altered model downloads without exposing a ready engine", async () => {
  directory = await mkdtemp(join(tmpdir(), "mycellios-voice-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("abd")));
  const voice = new LocalVoice(directory);

  await expect(voice.prepare()).rejects.toThrow("integrity");
  expect(voice.status()).toMatchObject({ ready: false, preparing: false, error: expect.any(String) });
  await expect(voice.run(1, { samples: new Float32Array([0]) })).rejects.toThrow("not ready");
});

it("recognizes verified models after restarting without downloading them", async () => {
  directory = await mkdtemp(join(tmpdir(), "mycellios-voice-"));
  const fetchModel = vi.fn();
  vi.stubGlobal("fetch", fetchModel);
  for (const kind of ["asr", "tts"]) {
    await mkdir(join(directory, kind));
    await writeFile(join(directory, kind, "model.onnx"), "abc");
  }
  const voice = new LocalVoice(directory);
  expect(voice.status().ready).toBe(false);
  expect(await voice.statusFromDisk()).toMatchObject({ ready: true, preparing: false, downloaded: 6, total: 6 });
  await voice.prepare();
  expect(fetchModel).not.toHaveBeenCalled();
});

it("checks installed models independently and removes only the selected pinned files", async () => {
  directory = await mkdtemp(join(tmpdir(), "mycellios-voice-"));
  const voice = new LocalVoice(directory);
  for (const kind of ["asr", "tts"]) {
    await mkdir(join(directory, kind));
    await writeFile(join(directory, kind, "model.onnx"), "abc");
  }
  const extra = join(directory, "asr", "notes.txt");
  await writeFile(extra, "unmanaged");
  expect((await voice.statusFromDisk()).ready).toBe(true);

  await voice.removeModel("asr");

  const status = await voice.statusFromDisk();
  expect(status.ready).toBe(false);
  expect(status.models?.asr.ready).toBe(false);
  expect(status.models?.tts.ready).toBe(true);
  await expect(readFile(extra, "utf8")).resolves.toBe("unmanaged");
  await expect(readFile(join(directory, "asr", "model.onnx"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("downloads one model once for concurrent callers and blocks removal during the download", async () => {
  directory = await mkdtemp(join(tmpdir(), "mycellios-voice-"));
  const voice = new LocalVoice(directory);
  const fetchModel = vi.fn(async () => new Response("abc"));
  vi.stubGlobal("fetch", fetchModel);

  const preparation = voice.prepareModel("asr");
  const joined = voice.prepareModel("asr");
  await expect(voice.removeModel("asr")).rejects.toThrow(/finish/);
  await Promise.all([preparation, joined]);

  expect(fetchModel).toHaveBeenCalledOnce();
  expect(fetchModel).toHaveBeenCalledWith("https://models.example/asr", expect.any(Object));
  expect(voice.status().models?.asr.ready).toBe(true);
  expect(voice.status().models?.tts.ready).toBe(false);
  expect(() => requireVoiceModelKind("../tts")).toThrow(/Invalid voice model/);
});
