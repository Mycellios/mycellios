import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { LocalVoice } from "./local-voice.js";
it("refuses altered model downloads without exposing a ready engine", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mycellios-voice-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1,2,3]))));
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
