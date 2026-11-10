import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_AUDIO_BYTES, Speaker, VOICE_RESPONSE_TIMEOUT_MS } from "./tts.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSelectedSpace(id: string) {
  const store = new Map<string, string>([["rakazo:space-id", id]]);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return (next: string) => store.set("rakazo:space-id", next);
}

describe("Speaker", () => {
  it("reads manually with a device voice and makes no network request", async () => {
    const fetchMock = vi.fn();
    const cancel = vi.fn();
    let utterance: SpeechSynthesisUtterance | undefined;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { language: "es-ES" });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(public text: string) {}
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
      },
    );
    vi.stubGlobal("window", {
      speechSynthesis: {
        getVoices: () => [{ localService: true, lang: "es-ES" }],
        speak: (value: SpeechSynthesisUtterance) => {
          utterance = value;
        },
        cancel,
      },
    });
    const speaker = new Speaker();
    const pending = speaker.speak("Hola", { browser: true, messageId: "reply" });
    expect(speaker.state).toMatchObject({ status: "speaking", messageId: "reply" });
    expect(utterance?.text).toBe("Hola");
    speaker.stop();
    await expect(pending).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(speaker.state.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send reply text to an online browser voice", async () => {
    const speak = vi.fn();
    vi.stubGlobal("navigator", { language: "en" });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    vi.stubGlobal("window", {
      speechSynthesis: {
        getVoices: () => [{ localService: false, lang: "en-US" }],
        speak,
      },
    });
    const speaker = new Speaker();
    await expect(speaker.speak("Private reply", { browser: true })).resolves.toContain(
      "No device voice",
    );
    expect(speak).not.toHaveBeenCalled();
    expect(speaker.state.status).toBe("idle");
  });

  it("interrupting before audio arrives leaves the speaker idle", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockImplementation(() => new Promise(() => undefined));
    const pending = speaker.speak("Hello there.", { messageId: "m1" });
    speaker.stop();
    await expect(pending).resolves.toBeUndefined();
    expect(speaker.state.status).toBe("idle");
  });

  it("does not report a failure for a request a newer one replaced", async () => {
    const speaker = new Speaker();
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(speaker as unknown as { prepare: () => Promise<string[]> }, "prepare")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce([]);
    const first = speaker.speak("First.", { messageId: "m1" });
    await speaker.speak("Second.", { messageId: "m2" });
    fail(new Error("Your voice provider is out of credit."));
    await expect(first).resolves.toBeUndefined();
    expect(speaker.state.error).toBeUndefined();
  });

  it("resolves with an error snapshot instead of rejecting", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockRejectedValue(new Error("ElevenLabs rejected that key."));
    await expect(speaker.speak("Hi there.")).resolves.toBe("ElevenLabs rejected that key.");
    expect(speaker.state.error).toBe("ElevenLabs rejected that key.");
  });

  it.each([
    { spaceId: undefined, expectedSpaceId: "space-support" },
    { spaceId: "space-edited", expectedSpaceId: "space-edited" },
  ])("keeps both speech requests in $expectedSpaceId", async ({ spaceId, expectedSpaceId }) => {
    const changeSelectedSpace = stubSelectedSpace("space-support");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      blob: async () => new Blob(["audio"]),
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const speaker = new Speaker();
    const prepare = vi
      .spyOn(
        speaker as unknown as {
          prepare: (
            text: string,
            opts: unknown,
            signal: AbortSignal,
            spaceId: string | null,
          ) => Promise<string[]>;
        },
        "prepare",
      )
      .mockImplementation(async () => {
        changeSelectedSpace("space-other");
        return ["Hello."];
      });
    await speaker.speak("Hello.", { messageId: "m1", spaceId });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/speak",
      expect.objectContaining({ credentials: "include" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-rakazo-space-id")).toBe(expectedSpaceId);
    expect(headers.get("content-type")).toBe("application/json");
    expect(prepare.mock.calls[0]?.[3]).toBe(expectedSpaceId);
  });

  it("rejects oversized audio without waiting for response cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": String(MAX_VOICE_AUDIO_BYTES + 1) },
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    await expect(speaker.speak("Hello.")).resolves.toBe("Voice response is too large.");

    expect(speaker.state.error).toBe("Voice response is too large.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["VOICE_OUT_OF_CREDIT", 402, "Your voice provider is out of credit."],
    ["VOICE_KEY_REJECTED", 403, "Your voice provider key was rejected."],
  ])("shows its own copy for %s", async (code, status, copy) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Insufficient API credit at fish.audio", code }), {
            status,
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    await expect(speaker.speak("Hello.")).resolves.toBe(copy);

    expect(speaker.state.error).toBe(copy);
  });

  it("times out while a voice response body is stalled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull: () => new Promise<void>(() => undefined),
            }),
          ),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    const pending = speaker.speak("Hello.");
    await vi.advanceTimersByTimeAsync(VOICE_RESPONSE_TIMEOUT_MS);
    await pending;

    expect(speaker.state.error).toBe("Voice request timed out.");
  });
});

describe("local speech routing", () => {
 it("does not send text to a provider when the local model is not ready", async () => {
   const fetchMock=vi.fn(); vi.stubGlobal("fetch",fetchMock);
   const speak=vi.fn(); vi.stubGlobal("window",{rakazoDesktop:{localVoice:{status:async()=>({ready:false}),speak,stop:vi.fn(async()=>{})}}});
   const speaker=new Speaker(); const error=await speaker.speak("Hola",{browser:true});
   expect(error).toContain("Supertonic"); expect(fetchMock).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled();
 });
 it("discards an inference result after playback is cancelled without making a paid fallback request", async () => {
   let finish!: (v:unknown)=>void;
   const speak=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),stop=vi.fn(async()=>{}),fetchMock=vi.fn();
   vi.stubGlobal("fetch",fetchMock); vi.stubGlobal("navigator",{language:"es-ES"});
   vi.stubGlobal("window",{rakazoDesktop:{localVoice:{status:async()=>({ready:true}),speak,stop}}});
   const speaker=new Speaker(); const pending=speaker.speak("Hola");
   await vi.waitFor(()=>expect(speak).toHaveBeenCalled()); speaker.stop(); finish({samples:new Float32Array([0]),sampleRate:24000}); await pending;
   expect(stop).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled(); expect(speaker.state.status).toBe("idle");
 });
});

it("renders local PCM audio with the selected speed without calling a speech provider", async () => {
 const fetchMock=vi.fn(),speak=vi.fn(async()=>({samples:new Float32Array([0,0.1,0]),sampleRate:24000}));
 vi.stubGlobal("fetch",fetchMock);vi.stubGlobal("navigator",{language:"es-ES"});
 vi.stubGlobal("window",{rakazoDesktop:{localVoice:{status:async()=>({ready:false,models:{asr:{ready:false},tts:{ready:true}}}),speak,stop:vi.fn(async()=>{})}}});
 const close=vi.fn(async()=>{}),copy=vi.fn();
 vi.stubGlobal("AudioContext",class {
  destination={};resume=async()=>{};close=close;
  createBuffer(){return {copyToChannel:copy};}
  createBufferSource(){return {buffer:null,connect:()=>{},onended:null as null|(()=>void),start(){queueMicrotask(()=>this.onended?.());}};}
 });
 const speaker=new Speaker(); expect(await speaker.speak("Hola",{speed:1.25})).toBeUndefined();
 expect(speak).toHaveBeenCalledWith({text:"Hola",language:"es",speed:1.25});
 expect(copy).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(fetchMock).not.toHaveBeenCalled();expect(speaker.state.status).toBe("idle");
});
