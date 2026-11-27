import { appPath } from "./app-path";
import { type RealtimeCallRpc, RealtimeCallTools } from "./realtime-call-tools";
import { withSpaceHeaders } from "./rpc.js";

/**
 * The realtime transport of a Mico call (specs/realtime-mico-calls/spec.md): the browser's
 * microphone and speaker talk to the provider over WebRTC, the offer goes through our server
 * (which keeps the person's key), and provider events arrive on the `oai-events` data channel.
 * Tool calls run here through RealtimeCallTools, with the person's own session.
 */

export type RealtimePhase = "listening" | "thinking" | "speaking";

export interface RealtimeCallHooks {
  phase(phase: RealtimePhase): void;
  user(text: string): void;
  bot(text: string): void;
  /** The model hung up (end_call) or the connection ended on its own. */
  ended(reason: "hang_up" | "lost"): void;
}

export interface RealtimeCallController {
  setMuted(muted: boolean): void;
  /** Tells the call about other work; spoken at the next pause. */
  notify(text: string): void;
  close(): void;
}

export class RealtimeUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const CHANNEL_OPEN_TIMEOUT_MS = 15_000;

export interface RealtimeEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeer(): RTCPeerConnection;
  createAudio(): HTMLAudioElement;
  fetch: typeof fetch;
}

const browserEnvironment = (): RealtimeEnvironment => ({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createPeer: () => new RTCPeerConnection(),
  createAudio: () => {
    const audio = document.createElement("audio");
    audio.autoplay = true;
    return audio;
  },
  fetch: (input, init) => fetch(input, init),
});

type ProviderEvent = { type?: string; [key: string]: unknown };

/** Connects a realtime call, or throws RealtimeUnavailableError so the caller can fall back. */
export async function connectRealtimeCall(options: {
  botId: string;
  micoName: string;
  callId: string;
  language?: string;
  spaceId?: string | null;
  rpc: RealtimeCallRpc;
  hooks: RealtimeCallHooks;
  environment?: RealtimeEnvironment;
}): Promise<RealtimeCallController> {
  const env = options.environment ?? browserEnvironment();
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new RealtimeUnavailableError("Could not use the microphone.", 0);
  }
  const peer = env.createPeer();
  const audio = env.createAudio();
  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  const fail = (message: string, status = 0): never => {
    stopTracks();
    peer.close();
    throw new RealtimeUnavailableError(message, status);
  };
  const [track] = stream.getAudioTracks();
  if (!track) fail("Could not use the microphone.");
  peer.addTrack(track as MediaStreamTrack, stream);
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null;
  };
  const channel = peer.createDataChannel("oai-events");
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  let res: Response;
  try {
    res = await env.fetch(appPath("/api/voice/realtime/call"), {
      method: "POST",
      credentials: "include",
      headers: withSpaceHeaders({ "content-type": "application/json" }, options.spaceId ?? null),
      body: JSON.stringify({ botId: options.botId, sdp: offer.sdp, language: options.language }),
    });
  } catch {
    return fail("The realtime call could not be started.");
  }
  const body = (await res.json().catch(() => ({}))) as { sdp?: unknown; error?: unknown };
  if (!res.ok || typeof body.sdp !== "string") {
    return fail(
      typeof body.error === "string" ? body.error : "The realtime call could not be started.",
      res.status,
    );
  }
  await peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
  await new Promise<void>((resolve, reject) => {
    if (channel.readyState === "open") return resolve();
    const timer = setTimeout(() => reject(new Error("timeout")), CHANNEL_OPEN_TIMEOUT_MS);
    channel.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
  }).catch(() => fail("The realtime call did not connect."));

  let closed = false;
  let responseActive = false;
  let needResponse = false;
  let personSpeaking = false;
  const notices: string[] = [];
  const send = (event: Record<string, unknown>) => {
    if (!closed && channel.readyState === "open") channel.send(JSON.stringify(event));
  };
  const requestResponse = () => {
    if (responseActive) {
      needResponse = true;
      return;
    }
    needResponse = false;
    responseActive = true;
    send({ type: "response.create" });
  };
  const flushNotices = () => {
    if (!notices.length || responseActive || personSpeaking) return;
    const text = notices.splice(0).join("\n");
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
    });
    requestResponse();
  };
  const close = (reason?: "hang_up" | "lost") => {
    if (closed) return;
    closed = true;
    tools.close();
    try {
      channel.close();
    } catch {
      // already closed
    }
    peer.close();
    stopTracks();
    audio.srcObject = null;
    if (reason) options.hooks.ended(reason);
  };
  const tools = new RealtimeCallTools({
    botId: options.botId,
    micoName: options.micoName,
    callId: options.callId,
    rpc: options.rpc,
    notify: (text) => {
      notices.push(text);
      flushNotices();
    },
    // Let the goodbye finish playing before the line drops.
    hangUp: () => setTimeout(() => close("hang_up"), 2_500),
  });
  const runTool = async (callId: string, name: string, args: string) => {
    const output = await tools.run(callId, name, args);
    if (output === null || closed) return;
    send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output },
    });
    if (name !== "end_call") requestResponse();
  };

  channel.addEventListener("message", (message) => {
    let event: ProviderEvent;
    try {
      event = JSON.parse(String(message.data)) as ProviderEvent;
    } catch {
      return;
    }
    const itemId = typeof event.item_id === "string" ? event.item_id : "";
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        personSpeaking = true;
        options.hooks.phase("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        personSpeaking = false;
        break;
      case "input_audio_buffer.committed":
        if (itemId) tools.transcriptPending(itemId);
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
        tools.transcriptDone(itemId, transcript);
        if (transcript) options.hooks.user(transcript);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        tools.transcriptDone(itemId);
        break;
      case "response.created":
        responseActive = true;
        options.hooks.phase("thinking");
        break;
      case "output_audio_buffer.started":
        options.hooks.phase("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        options.hooks.phase("listening");
        flushNotices();
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
        if (transcript) options.hooks.bot(transcript);
        break;
      }
      case "response.output_item.done": {
        const item = event.item as
          | { type?: string; call_id?: string; name?: string; arguments?: string }
          | undefined;
        if (item?.type === "function_call" && item.call_id && item.name) {
          void runTool(item.call_id, item.name, item.arguments ?? "{}");
        }
        break;
      }
      case "response.done":
        responseActive = false;
        if (needResponse) requestResponse();
        else flushNotices();
        break;
      default:
        break;
    }
  });
  channel.addEventListener("close", () => close("lost"));
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed" || peer.connectionState === "closed") close("lost");
  });

  // The Mico answers the phone.
  responseActive = true;
  send({
    type: "response.create",
    response: {
      instructions: `Answer the phone as ${options.micoName} with one short, friendly sentence.`,
    },
  });

  return {
    setMuted(muted) {
      if (track) track.enabled = !muted;
    },
    notify(text) {
      notices.push(`NOTICE: ${text}`);
      flushNotices();
    },
    close: () => close(),
  };
}
