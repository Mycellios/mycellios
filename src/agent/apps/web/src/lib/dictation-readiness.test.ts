import { afterEach, describe, expect, it, vi } from "vitest";
import { microphoneDeliversSignal, transcriptionProblem } from "./dictation-readiness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubAudio(sample: number) {
  class FakeContext {
    state = "running";
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(sample) };
    }
    createMediaStreamSource() { return { connect: () => undefined }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  vi.stubGlobal("AudioContext", FakeContext);
}
const stream = { getAudioTracks: () => [{ readyState: "live" }] } as unknown as MediaStream;

describe("microphoneDeliversSignal", () => {
  it("accepts any noise and refuses a stream of exact zeros", async () => {
    stubAudio(0.0001);
    await expect(microphoneDeliversSignal(stream, 300)).resolves.toBe(true);
    stubAudio(0);
    await expect(microphoneDeliversSignal(stream, 300)).resolves.toBe(false);
  });

  it("does not refuse when the signal cannot be measured", async () => {
    vi.stubGlobal("AudioContext", undefined);
    await expect(microphoneDeliversSignal(stream, 300)).resolves.toBeUndefined();
  });
});

describe("transcriptionProblem", () => {
  it("reports a local model that fails and warms one that works", async () => {
    const failing = { transcribe: vi.fn().mockRejectedValue(new Error("Model crashed")) };
    await expect(transcriptionProblem({ local: true, native: failing as never, network: null, spaceId: null }))
      .resolves.toBe("Model crashed");
    const working = { transcribe: vi.fn().mockResolvedValue({ text: "" }) };
    await expect(transcriptionProblem({ local: true, native: working as never, network: null, spaceId: null }))
      .resolves.toBeNull();
    expect(working.transcribe).toHaveBeenCalledWith(expect.any(Float32Array));
  });

  it("returns the server's reason before any audio is sent, and accepts older servers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Connect a voice provider." }, { status: 409 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { local: false, native: undefined, network: null, spaceId: "space" };
    await expect(transcriptionProblem(input)).resolves.toBe("Connect a voice provider.");
    await expect(transcriptionProblem(input)).resolves.toBeNull();
    await expect(transcriptionProblem(input)).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/voice\/transcribe\/check$/);
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("does not treat a slow check as a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    await expect(transcriptionProblem({ local: false, native: undefined, network: null, spaceId: null, timeoutMs: 20 }))
      .rejects.toThrow("timeout");
  });
});
