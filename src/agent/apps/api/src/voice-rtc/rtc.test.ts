import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU } from "werift";
import { speechToMuLaw } from "./audio.js";
import { localVoiceTrialEnabled, mountRtcVoiceTrial } from "./http.js";
import { decodeMuLaw, pcmToMuLaw, VoiceTurnDetector, wav8k } from "./pcm.js";
import { RtcVoiceSession } from "./session.js";

async function until(check: () => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Condition timed out");
    await delay(20);
  }
}
const tone = () =>
  Int16Array.from({ length: 160 }, (_, index) => Math.sin((index * Math.PI) / 10) * 12_000);

describe("local WebRTC voice MVP", () => {
  it("never enables the trial against a remote database or without opt-in", () => {
    expect(localVoiceTrialEnabled("1", "postgresql://user:secret@127.0.0.1:5432/local")).toBe(true);
    expect(localVoiceTrialEnabled("1", "postgresql://user:secret@prod.example/production")).toBe(
      false,
    );
    expect(localVoiceTrialEnabled(undefined, "postgresql://localhost/local")).toBe(false);
    expect(localVoiceTrialEnabled("1", "https://localhost/local")).toBe(false);
  });
  it("round-trips G.711 audio within its quantization error and encodes an ordinary WAV", () => {
    const pcm = Int16Array.from([-32000, -16000, -1000, 0, 1000, 16000, 32000]);
    const decoded = decodeMuLaw(pcmToMuLaw(pcm));
    decoded.forEach((value, index) => {
      expect(Math.abs(value - pcm[index]!)).toBeLessThan(700);
    });
    const wav = Buffer.from(wav8k(Array.from(pcm)));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(8000);
    expect(wav.length).toBe(44 + pcm.length * 2);
  });
  it("ends spoken turns on the server, bounds long input and ignores silence", () => {
    const detector = new VoiceTurnDetector();
    for (let i = 0; i < 100; i++) expect(detector.push(new Int16Array(160))).toBeUndefined();
    for (let i = 0; i < 20; i++) expect(detector.push(tone())).toBeUndefined();
    let result: number[] | undefined;
    for (let i = 0; i < 50; i++) result = detector.push(new Int16Array(160)) ?? result;
    expect(result?.length).toBe(11200);
    for (let i = 0; i < 602; i++) result = detector.push(tone()) ?? result;
    expect(result?.length).toBe(96000);
  });
  it("decodes provider speech using the real local ffmpeg and cancels before spawning", async () => {
    const pcm = Array.from(
      { length: 1600 },
      (_, index) => Math.sin((index * Math.PI) / 10) * 10_000,
    ).map(Math.round);
    const encoded = await speechToMuLaw(wav8k(pcm), new AbortController().signal);
    expect(encoded.length).toBe(1600);
    expect(decodeMuLaw(encoded).some((value) => Math.abs(value) > 5000)).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(() => speechToMuLaw(wav8k(pcm), controller.signal)).toThrow();
  });
  it("authenticates offers, refuses cross-origin controls and bounds negotiation bodies", async () => {
    const app = new Hono();
    const stop = mountRtcVoiceTrial(app, {
      authenticate: async () => null,
      trustedOrigin: (origin) => origin === "https://local.test",
      makeMico: () => {
        throw new Error("Unauthorized request reached Mico");
      },
    });
    try {
      expect((await app.request("http://local.test/api/voice/rtc/capability")).status).toBe(401);
      expect(
        (
          await app.request("http://local.test/api/voice/rtc/sessions", {
            method: "POST",
            headers: { origin: "https://evil.test", "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request("http://local.test/api/voice/rtc/sessions", {
            method: "POST",
            headers: { origin: "https://local.test", "content-type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(401);
    } finally {
      await stop();
    }
  });
  it("reserves the owner limit atomically while parallel offers are negotiating", async () => {
    const app = new Hono();
    let rejectValidation: (error: Error) => void = () => {};
    const validation = new Promise<void>((_resolve, reject) => {
      rejectValidation = reject;
    });
    const factory = vi.fn(() => ({
      validate: () => validation,
      transcribe: async () => "",
      reply: async () => "",
      speak: async () => Buffer.alloc(0),
    }));
    const stop = mountRtcVoiceTrial(app, {
      authenticate: async () => ({ userId: "user", spaceId: "space" }) as never,
      trustedOrigin: (origin) => origin === "https://local.test",
      makeMico: factory,
    });
    const offer = () =>
      app.request("https://local.test/api/voice/rtc/sessions", {
        method: "POST",
        headers: { origin: "https://local.test", "content-type": "application/json" },
        body: JSON.stringify({ botId: "mico", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n" }),
      });
    const opening = offer();
    try {
      await until(() => factory.mock.calls.length === 1);
      expect((await offer()).status).toBe(409);
      expect(factory).toHaveBeenCalledOnce();
      rejectValidation(new Error("End the isolated negotiation"));
      expect((await opening).status).toBe(400);
    } finally {
      rejectValidation(new Error("Cleanup"));
      await opening;
      await stop();
    }
  });
  it("exchanges real RTP both ways, completes a spoken turn and survives a hidden-page event", async () => {
    const transcribe = vi.fn(async () => "Hello Mico");
    const reply = vi.fn(async () => "Hello Daniel");
    const speak = vi.fn(async () =>
      Buffer.concat(Array.from({ length: 30 }, () => pcmToMuLaw(tone()))),
    );
    const closed = vi.fn();
    const server = new RtcVoiceSession(
      "owner",
      { botId: "existing-mico", taskThreadId: "owned-task" },
      { validate: async () => {}, transcribe, reply, speak },
      closed,
    );
    const peer = new RTCPeerConnection({
      codecs: { audio: [usePCMU()] },
      iceServers: [],
      iceUseIpv6: false,
    });
    const source = new MediaStreamTrack({ kind: "audio" });
    const transceiver = peer.addTransceiver(source, { direction: "sendrecv" });
    const channel = peer.createDataChannel("mico-voice");
    const events: Record<string, unknown>[] = [];
    channel.onMessage.subscribe((raw) => {
      if (typeof raw === "string") events.push(JSON.parse(raw));
    });
    let inbound = 0,
      audible = 0;
    transceiver.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe((packet) => {
        inbound++;
        if (decodeMuLaw(packet.payload).some((value) => Math.abs(value) > 3000)) audible++;
      }),
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      await peer.setLocalDescription(await peer.createOffer());
      const sdp = await server.answer(peer.localDescription!.sdp);
      await peer.setRemoteDescription({ type: "answer", sdp });
      await until(() => peer.connectionState === "connected" && channel.readyState === "open");
      channel.send(JSON.stringify({ type: "page", value: "hidden" }));
      channel.send(JSON.stringify({ type: "lock-check" }));
      let sequence = 0;
      timer = setInterval(() => {
        const payload = sequence < 25 ? pcmToMuLaw(tone()) : Buffer.alloc(160, 255);
        source.writeRtp(
          new RtpPacket(
            new RtpHeader({
              payloadType: 0,
              sequenceNumber: sequence & 65535,
              timestamp: sequence * 160,
              ssrc: transceiver.sender.ssrc,
            }),
            payload,
          ),
        );
        sequence++;
      }, 20);
      await until(() => audible > 5 && events.some((event) => event.phase === "speaking"));
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(reply.mock.calls[0]?.[1]).toMatch(/^call:[^:]+:/);
      expect(inbound).toBeGreaterThan(20);
      expect(server.report()).toMatchObject({ lastPageState: "hidden", turns: 1, closed: false });
      // This tests RTP transport, not a physical Android/iPhone screen lock.
      const before = server.report().receivedPackets;
      channel.send(JSON.stringify({ type: "mute", value: true }));
      await delay(1100);
      expect(server.report().receivedPackets).toBeGreaterThan(before);
      expect(transcribe).toHaveBeenCalledTimes(1);
      channel.send(JSON.stringify({ type: "stop" }));
      await until(() => server.report().closed);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      clearInterval(timer);
      await server.close();
      await peer.close();
    }
  }, 30_000);
});
