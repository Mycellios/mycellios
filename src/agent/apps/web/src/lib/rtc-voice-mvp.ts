import { appPath } from "./app-path";
import { withSpaceHeaders } from "./rpc";

export type VoiceTrialEvent = {
  type: string;
  phase?: string;
  caption?: string;
  heard?: string;
  error?: string;
  [key: string]: unknown;
};
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
function voiceMediaAction(action: "hangup" | "togglemicrophone", handler: (() => void) | null) {
  // These call actions are supported by some engines before appearing in lib.dom.
  const session = navigator.mediaSession as unknown as {
    setActionHandler(action: string, handler: (() => void) | null): void;
  };
  try {
    session.setActionHandler(action, handler);
  } catch {
    /* Optional lock-screen controls. */
  }
}

/** One continuous microphone/remote stream. No MediaRecorder or foreground turn timer. */
export class RtcVoiceTrial {
  private pc?: RTCPeerConnection;
  private mic?: MediaStream;
  private audio?: HTMLAudioElement;
  private channel?: RTCDataChannel;
  private id?: string;
  private stopped = false;
  private controller = new AbortController();
  private previousAudioType?: string;
  private lastStats: VoiceTrialEvent | undefined;
  private history: VoiceTrialEvent[] = [];
  private muted = false;
  private visibility = () => this.send({ type: "page", value: document.visibilityState });
  constructor(
    private target: { botId: string; taskThreadId?: string },
    private spaceId: string | null,
    private onEvent: (event: VoiceTrialEvent) => void,
  ) {}

  private event(value: VoiceTrialEvent) {
    this.history.push({ at: Date.now(), ...value });
    if (this.history.length > 100) this.history.shift();
    this.onEvent(value);
  }
  private async request(path: string, body?: object, signal?: AbortSignal) {
    const response = await fetch(appPath(`/api/voice/rtc/${path}`), {
      method: body ? "POST" : "GET",
      credentials: "include",
      headers: withSpaceHeaders(
        body ? { "content-type": "application/json" } : undefined,
        this.spaceId,
      ),
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    if (!response.ok)
      throw new Error(
        "No se pudo conectar la prueba de voz local. Revisa el Mico y sus servicios de voz.",
      );
    return response.json();
  }
  async start() {
    if (this.pc || this.stopped) throw new Error("Esta prueba de voz ya se inició o terminó.");
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.RTCPeerConnection
    ) {
      throw new Error("Abre la prueba con HTTPS para permitir el micrófono en el móvil.");
    }
    this.event({ type: "state", phase: "connecting" });
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    const audio = document.createElement("audio");
    this.audio = audio;
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    const incoming = new MediaStream();
    audio.srcObject = incoming;
    pc.ontrack = (event) => {
      incoming.addTrack(event.track);
      void this.resumeAudio();
    };
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) {
      try {
        this.previousAudioType = session.type;
        session.type = "play-and-record";
      } catch {
        /* Unsupported browser. */
      }
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (this.stopped) {
        mic.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      this.mic = mic;
      const track = mic.getAudioTracks()[0];
      if (!track) throw new Error("No se ha encontrado un micrófono.");
      const transceiver = pc.addTransceiver(track, { direction: "sendrecv", streams: [mic] });
      const codecs = RTCRtpReceiver.getCapabilities?.("audio")?.codecs.filter(
        (codec) => codec.mimeType.toLowerCase() === "audio/pcmu",
      );
      if (!codecs?.length) throw new Error("El navegador no ofrece el códec de la prueba de voz.");
      transceiver.setCodecPreferences(codecs);
      this.channel = pc.createDataChannel("mico-voice");
      this.channel.onopen = () => {
        this.visibility();
        this.send({ type: "stats" });
      };
      this.channel.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data.length > 16_384) return;
        try {
          const value = JSON.parse(event.data) as VoiceTrialEvent;
          if (value.type === "stats") this.lastStats = value;
          this.event(value);
          if (value.type === "closed") void this.stop();
        } catch {
          /* A malformed control event is not a command. */
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") this.event({ type: "state", phase: "listening" });
        if (["failed", "closed"].includes(pc.connectionState)) void this.stop();
      };
      await pc.setLocalDescription(await pc.createOffer());
      await this.waitForIce(pc);
      const answer = await this.request(
        "sessions",
        { ...this.target, sdp: pc.localDescription?.sdp },
        this.controller.signal,
      );
      this.id = answer.id;
      if (this.stopped) {
        await this.stopServer();
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      document.addEventListener("visibilitychange", this.visibility);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Mycellios · Prueba de voz" });
        for (const [action, handler] of [
          ["hangup", () => void this.stop()],
          ["togglemicrophone", () => this.setMuted(!this.muted)],
        ] as const) {
          voiceMediaAction(action, handler);
        }
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", change);
        this.controller.signal.removeEventListener("abort", abort);
      };
      const change = () => {
        if (pc.iceGatheringState === "complete") {
          cleanup();
          resolve();
        }
      };
      const abort = () => {
        cleanup();
        reject(new Error("Llamada cancelada."));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("La conexión de audio tardó demasiado."));
      }, 15_000);
      pc.addEventListener("icegatheringstatechange", change);
      this.controller.signal.addEventListener("abort", abort, { once: true });
      if (this.controller.signal.aborted) abort();
      else change();
    });
  }
  private send(value: object) {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(value));
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.mic?.getAudioTracks().forEach((track) => {
      track.enabled = !value;
    });
    this.send({ type: "mute", value });
  }
  async resumeAudio() {
    try {
      await this.audio?.play();
    } catch {
      this.event({ type: "needs-playback", error: "Pulsa Activar audio para escuchar al Mico." });
    }
  }
  checkLock() {
    this.send({ type: "lock-check" });
    this.stats();
  }
  stats() {
    this.send({ type: "stats" });
  }
  diagnostic() {
    // Visibility is not proof that an Android/iPhone was physically locked.
    return {
      version: 1,
      transport: "webrtc-pcmu",
      target: this.target,
      userAgent: navigator.userAgent,
      physicalLockResult: "unverified",
      stats: this.lastStats,
      events: this.history.map(({ heard: _heard, caption: _caption, ...event }) => event),
    };
  }
  private async stopServer() {
    const id = this.id;
    this.id = undefined;
    if (id)
      await this.request(
        `sessions/${encodeURIComponent(id)}/stop`,
        {},
        AbortSignal.timeout(3000),
      ).catch(() => undefined);
  }
  async stop() {
    if (!this.stopped) {
      this.stopped = true;
      this.send({ type: "stop" });
      this.controller.abort();
      document.removeEventListener("visibilitychange", this.visibility);
      this.mic?.getTracks().forEach((track) => {
        track.stop();
      });
      this.audio?.pause();
      if (this.audio) this.audio.srcObject = null;
      this.channel?.close();
      this.pc?.close();
      const session = (navigator as AudioSessionNavigator).audioSession;
      if (session && this.previousAudioType !== undefined) {
        try {
          session.type = this.previousAudioType;
        } catch {
          /* Optional API. */
        }
      }
      if ("mediaSession" in navigator) {
        for (const action of ["hangup", "togglemicrophone"] as const)
          voiceMediaAction(action, null);
        navigator.mediaSession.metadata = null;
      }
      this.event({ type: "closed" });
    }
    await this.stopServer();
  }
}
