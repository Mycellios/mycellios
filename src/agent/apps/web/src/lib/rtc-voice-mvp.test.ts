// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { RtcVoiceTrial } from "./rtc-voice-mvp";

vi.mock("./app-path", () => ({ appPath: (path: string) => path }));
vi.mock("./rpc", () => ({
  withSpaceHeaders: (headers: HeadersInit, space: string) =>
    new Headers({ ...headers, "x-rakazo-space-id": space }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function browser() {
  const stopped = vi.fn();
  const track = { stop: stopped, enabled: true };
  const mic = { getTracks: () => [track], getAudioTracks: () => [track] };
  const peer = {
    addTransceiver: vi.fn(() => ({ setCodecPreferences: vi.fn() })),
    close: vi.fn(),
    createDataChannel: vi.fn(() => ({ readyState: "open", send: vi.fn(), close: vi.fn() })),
    createOffer: vi.fn(async () => ({})),
    setLocalDescription: vi.fn(async () => {}),
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0" },
    setRemoteDescription: vi.fn(async () => {}),
  };
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("RTCPeerConnection", new Proxy(class {}, { construct: () => peer }));
  vi.stubGlobal("RTCRtpReceiver", {
    getCapabilities: () => ({ codecs: [{ mimeType: "audio/PCMU" }] }),
  });
  vi.stubGlobal(
    "MediaStream",
    class {
      addTrack = vi.fn();
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const getUserMedia = vi.fn(async () => mic);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return { stopped, mic, peer, getUserMedia };
}
describe("shared PWA WebRTC voice lifecycle", () => {
  it("stops a microphone granted after the user already cancelled", async () => {
    const b = browser();
    let grant: (stream: typeof b.mic) => void = () => {};
    b.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const client = new RtcVoiceTrial({ botId: "mico" }, "space", () => {});
    const opening = client.start();
    await client.stop();
    grant(b.mic);
    await opening;
    expect(b.stopped).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps the same mic while the page is hidden, scopes requests, and hangs up cleanly", async () => {
    const b = browser();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ id: "session-one", sdp: "answer" }),
    }));
    vi.stubGlobal("fetch", fetcher);
    const client = new RtcVoiceTrial(
      { botId: "mico", taskThreadId: "owned-task" },
      "space",
      () => {},
    );
    await client.start();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(b.stopped).not.toHaveBeenCalled();
    expect(b.getUserMedia).toHaveBeenCalledOnce();
    const options = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("x-rakazo-space-id")).toBe("space");
    expect(JSON.parse(String(options.body))).toMatchObject({
      botId: "mico",
      taskThreadId: "owned-task",
    });
    expect(client.diagnostic().physicalLockResult).toBe("unverified");
    await client.stop();
    expect(b.stopped).toHaveBeenCalledOnce();
    expect(b.peer.close).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[1]?.[0]).toContain("session-one/stop");
  });
});
