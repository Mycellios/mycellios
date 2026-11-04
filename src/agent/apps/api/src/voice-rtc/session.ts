import { randomInt, randomUUID } from "node:crypto";
import { callClientNonce } from "@rakazo/core";
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, usePCMU } from "werift";
import { decodeMuLaw, VoiceTurnDetector, wav8k } from "./pcm.js";

export type RtcVoiceTarget = { botId: string; taskThreadId?: string };
export interface RtcMico {
  validate(): Promise<void>;
  transcribe(audio: Uint8Array, signal: AbortSignal): Promise<string>;
  reply(text: string, nonce: string, signal: AbortSignal): Promise<string>;
  speak(text: string, signal: AbortSignal): Promise<Buffer>;
}
export class RtcVoiceSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  readonly pc = new RTCPeerConnection({
    codecs: { audio: [usePCMU()] },
    iceServers: [],
    iceUseIpv6: false,
  });
  private track = new MediaStreamTrack({ kind: "audio" });
  private detector = new VoiceTurnDetector();
  private output: Buffer = Buffer.alloc(0);
  private offset = 0;
  private timer: NodeJS.Timeout;
  private lease: NodeJS.Timeout;
  private expiry: NodeJS.Timeout;
  private connectTimeout: NodeJS.Timeout;
  private channelAccepted = false;
  private interruptSamples = 0;
  private controller = new AbortController();
  private turn: AbortController | undefined;
  private sendEvent: (value: object) => void = () => {};
  private seq = randomInt(65536);
  private timestamp = randomInt(0x7fffffff);
  private busy = false;
  private closed = false;
  private lastSequence: number | undefined;
  private muted = false;
  private status = "connecting";
  private metrics = {
    receivedPackets: 0,
    sentPackets: 0,
    receivedSamples: 0,
    lastAudioAt: 0,
    turns: 0,
    lastPageState: "unknown",
    lockCheckStartedAt: 0,
  };
  constructor(
    readonly owner: string,
    readonly target: RtcVoiceTarget,
    private readonly mico: RtcMico,
    private readonly onClose: () => void,
  ) {
    const transceiver = this.pc.addTransceiver(this.track, { direction: "sendrecv" });
    transceiver.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe((packet) => {
        if (
          this.closed ||
          packet.header.payloadType !== 0 ||
          !packet.payload.length ||
          packet.payload.length > 8000
        )
          return;
        const sequence = packet.header.sequenceNumber;
        if (this.lastSequence !== undefined) {
          const delta = (sequence - this.lastSequence + 65536) % 65536;
          if (delta === 0 || delta > 32768) return;
          if (delta > 100) this.detector.reset();
        }
        this.lastSequence = sequence;
        this.metrics.receivedPackets++;
        this.metrics.lastAudioAt = Date.now();
        const pcm = decodeMuLaw(packet.payload);
        this.metrics.receivedSamples += pcm.length;
        if (this.muted) return;
        const energy = pcm.reduce((sum, value) => sum + value * value, 0) / Math.max(1, pcm.length);
        this.interruptSamples =
          this.output.length && energy > 2500000 ? this.interruptSamples + pcm.length : 0;
        if (this.interruptSamples >= 1600) {
          this.output = Buffer.alloc(0);
          this.offset = 0;
          this.interruptSamples = 0;
          this.event("listening");
        }
        if (this.busy) return;
        const words = this.detector.push(pcm);
        if (words) void this.process(words);
      }),
    );
    this.pc.onDataChannel.subscribe((channel) => {
      if (channel.label !== "mico-voice" || this.channelAccepted) {
        channel.close();
        return;
      }
      this.channelAccepted = true;
      this.sendEvent = (value) => {
        if (channel.readyState === "open") channel.send(JSON.stringify(value));
      };
      channel.onMessage.subscribe((raw) => {
        if (typeof raw !== "string" || raw.length > 512) return;
        try {
          const input = JSON.parse(raw);
          if (input.type === "mute" && typeof input.value === "boolean") {
            this.muted = input.value;
            this.detector.reset();
          }
          if (input.type === "stop") void this.close();
          if (input.type === "page" && ["visible", "hidden"].includes(input.value))
            this.metrics.lastPageState = input.value;
          if (input.type === "lock-check") this.metrics.lockCheckStartedAt = Date.now();
          if (input.type === "stats") this.sendEvent(this.report());
        } catch {
          /* Untrusted control payload. */
        }
      });
    });
    this.pc.connectionStateChange.subscribe((state) => {
      if (state === "connected") {
        clearTimeout(this.connectTimeout);
        this.event("listening");
      }
      if (state === "failed" || state === "closed") void this.close();
    });
    this.connectTimeout = setTimeout(() => {
      void this.close();
    }, 30000);
    this.connectTimeout.unref();
    this.timer = setInterval(() => {
      if (this.closed || this.pc.connectionState !== "connected") return;
      const payload = Buffer.alloc(160, 255);
      const count = Math.min(160, this.output.length - this.offset);
      if (count > 0) {
        this.output.copy(payload, 0, this.offset, this.offset + count);
        this.offset += count;
      }
      if (this.output.length && this.offset >= this.output.length) {
        this.output = Buffer.alloc(0);
        this.offset = 0;
        this.event("listening");
      }
      this.timestamp = (this.timestamp + 160) >>> 0;
      this.seq = (this.seq + 1) & 65535;
      const packet = new RtpPacket(
        new RtpHeader({
          payloadType: 0,
          sequenceNumber: this.seq,
          timestamp: this.timestamp,
          ssrc: transceiver.sender.ssrc,
        }),
        payload,
      );
      try {
        this.track.writeRtp(packet);
        this.metrics.sentPackets++;
      } catch {
        void this.close();
      }
    }, 20);
    this.timer.unref();
    let checking = false;
    this.lease = setInterval(() => {
      if (checking) return;
      checking = true;
      void mico
        .validate()
        .catch(() => this.close())
        .finally(() => {
          checking = false;
        });
    }, 15000);
    this.lease.unref();
    this.expiry = setTimeout(() => {
      void this.close();
    }, 15 * 60_000);
    this.expiry.unref();
  }
  async answer(offer: string) {
    await this.mico.validate();
    await this.pc.setRemoteDescription({ type: "offer", sdp: offer });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    return this.pc.localDescription!.sdp;
  }
  report() {
    return {
      type: "stats",
      id: this.id,
      phase: this.status,
      createdAt: this.createdAt,
      ...this.metrics,
      closed: this.closed,
    };
  }
  private event(phase: string, extra: object = {}) {
    this.status = phase;
    this.sendEvent({ type: "state", phase, ...extra });
  }
  private async process(samples: number[]) {
    if (this.closed || this.busy) return;
    this.busy = true;
    const turn = new AbortController();
    this.turn = turn;
    const signal = AbortSignal.any([
      this.controller.signal,
      turn.signal,
      AbortSignal.timeout(120000),
    ]);
    try {
      this.event("transcribing");
      await this.mico.validate();
      const text = (await this.mico.transcribe(wav8k(samples), signal)).trim();
      if (!text || this.closed || this.muted) return;
      this.event("thinking", { heard: text.slice(0, 500) });
      this.metrics.turns++;
      const reply = await this.mico.reply(text, callClientNonce(this.id), signal);
      if (this.closed) return;
      if (!reply.trim()) throw new Error("No spoken reply.");
      const audio = await this.mico.speak(reply.slice(0, 8000), signal);
      signal.throwIfAborted();
      this.output = audio;
      this.offset = 0;
      this.event("speaking", { caption: reply.slice(0, 1000) });
    } catch {
      if (!this.closed) {
        this.event("error", {
          error: "La voz se ha interrumpido. Revisa el chat antes de volver a intentarlo.",
        });
        await this.close();
      }
    } finally {
      this.busy = false;
      this.detector.reset();
      if (this.turn === turn) this.turn = undefined;
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.turn?.abort();
    clearInterval(this.timer);
    clearInterval(this.lease);
    clearTimeout(this.expiry);
    clearTimeout(this.connectTimeout);
    this.output = Buffer.alloc(0);
    this.sendEvent({ type: "closed" });
    this.onClose();
    await this.pc.close();
  }
}
