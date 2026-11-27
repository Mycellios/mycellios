import type { ThreadSnapshot } from "@mycellios/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  connectRealtimeCall,
  type RealtimeEnvironment,
  RealtimeUnavailableError,
} from "./realtime-call";

vi.mock("./rpc.js", () => ({ withSpaceHeaders: (headers: Record<string, string>) => headers }));
vi.mock("./app-path", () => ({ appPath: (path: string) => path }));

class FakeChannel extends EventTarget {
  readyState = "connecting";
  sent: Array<Record<string, unknown>> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
  emit(event: Record<string, unknown>) {
    const message = new Event("message") as Event & { data: string };
    message.data = JSON.stringify(event);
    this.dispatchEvent(message);
  }
}

function environment(response: () => Response) {
  const channel = new FakeChannel();
  const track = { enabled: true, stop: vi.fn() };
  const peer = Object.assign(new EventTarget(), {
    connectionState: "new",
    ontrack: null as unknown,
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => {
      queueMicrotask(() => channel.open());
    }),
    close: vi.fn(),
  });
  const fetchMock = vi.fn(async () => response());
  const env: RealtimeEnvironment = {
    getUserMedia: vi.fn(
      async () =>
        ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
    ),
    createPeer: () => peer as unknown as RTCPeerConnection,
    createAudio: () => ({ srcObject: null }) as unknown as HTMLAudioElement,
    fetch: fetchMock as unknown as typeof fetch,
  };
  return { env, channel, peer, track, fetchMock };
}

const emptyThread = {
  threadId: "t1",
  cursor: 0,
  messages: [],
  olderCursor: null,
  run: null,
} as unknown as ThreadSnapshot;

function rpc() {
  return {
    threads: {
      get: vi.fn(async () => emptyThread),
      send: vi.fn(async () => ({})),
      followUp: vi.fn(async () => ({})),
      answer: vi.fn(async () => ({})),
    },
  };
}

function hooks() {
  return { phase: vi.fn(), user: vi.fn(), bot: vi.fn(), ended: vi.fn() };
}

async function connected() {
  const fake = environment(() => Response.json({ sdp: "v=0 answer", model: "gpt-realtime" }));
  const calls = rpc();
  const events = hooks();
  const controller = await connectRealtimeCall({
    botId: "bot-1",
    micoName: "Ada",
    callId: "call1",
    language: "es",
    rpc: calls,
    hooks: events,
    environment: fake.env,
  });
  return { ...fake, calls, events, controller };
}

describe("connectRealtimeCall", () => {
  it("negotiates through the server, then lets the Mico answer the phone", async () => {
    const { fetchMock, peer, channel } = await connected();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/realtime/call",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ botId: "bot-1", sdp: "v=0 offer", language: "es" }),
      }),
    );
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "v=0 answer" });
    expect(channel.sent[0]).toMatchObject({ type: "response.create" });
  });

  it("reports why it is unavailable so the call can fall back", async () => {
    const fake = environment(() =>
      Response.json({ error: "Realtime calls are not enabled on this server." }, { status: 404 }),
    );
    const failure = connectRealtimeCall({
      botId: "bot-1",
      micoName: "Ada",
      callId: "call1",
      rpc: rpc(),
      hooks: hooks(),
      environment: fake.env,
    });
    await expect(failure).rejects.toBeInstanceOf(RealtimeUnavailableError);
    await expect(failure).rejects.toThrow("not enabled");
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.peer.close).toHaveBeenCalled();
  });

  it("maps provider events to the call card", async () => {
    const { channel, events } = await connected();
    channel.emit({ type: "input_audio_buffer.speech_started" });
    channel.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "i1",
      transcript: " Hola ",
    });
    channel.emit({ type: "response.created" });
    channel.emit({ type: "output_audio_buffer.started" });
    channel.emit({
      type: "response.output_audio_transcript.done",
      transcript: "¡Hola! ¿Qué necesitas?",
    });
    channel.emit({ type: "output_audio_buffer.stopped" });

    expect(events.user).toHaveBeenCalledWith("Hola");
    expect(events.bot).toHaveBeenCalledWith("¡Hola! ¿Qué necesitas?");
    expect(events.phase.mock.calls.map(([phase]) => phase)).toEqual([
      "listening",
      "thinking",
      "speaking",
      "listening",
    ]);
  });

  it("returns a tool's output and asks for the next response once the current one ends", async () => {
    const { channel, calls } = await connected();
    channel.emit({ type: "response.done" });
    channel.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "i1",
      transcript: "Pon una alarma",
    });
    channel.emit({ type: "response.created" });
    channel.emit({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: "fc1", name: "read_conversation", arguments: "{}" },
    });
    await vi.waitFor(() =>
      expect(channel.sent.some((event) => event.type === "conversation.item.create")).toBe(true),
    );
    const before = channel.sent.filter((event) => event.type === "response.create").length;
    channel.emit({ type: "response.done" });
    expect(channel.sent.filter((event) => event.type === "response.create").length).toBe(
      before + 1,
    );
    expect(channel.sent.find((event) => event.type === "conversation.item.create")).toMatchObject({
      item: { type: "function_call_output", call_id: "fc1", output: "The conversation is empty." },
    });
    expect(calls.threads.send).not.toHaveBeenCalled();
  });

  it("holds notices until nobody is talking", async () => {
    const { channel, controller } = await connected();
    controller.notify("Bruno finished.");
    expect(channel.sent.some((event) => event.type === "conversation.item.create")).toBe(false);
    channel.emit({ type: "response.done" });
    expect(channel.sent.find((event) => event.type === "conversation.item.create")).toMatchObject({
      item: { role: "system", content: [{ type: "input_text", text: "NOTICE: Bruno finished." }] },
    });
  });

  it("mutes the microphone and releases everything on close", async () => {
    const { controller, track, peer, events } = await connected();
    controller.setMuted(true);
    expect(track.enabled).toBe(false);
    controller.close();
    expect(track.stop).toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(events.ended).not.toHaveBeenCalled();
  });

  it("tells the call when the line drops", async () => {
    const { channel, events } = await connected();
    channel.dispatchEvent(new Event("close"));
    expect(events.ended).toHaveBeenCalledWith("lost");
  });
});
