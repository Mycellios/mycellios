import { I18nProvider } from "@lingui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { queryClient } from "../../src/lib/query";
import { Composer } from "../../src/pages/shell/composer";
import type { PendingAttachment } from "../../src/pages/shell/chat-shared";
import "../../src/styles.css";

const noop = () => {};
const parameters = new URLSearchParams(location.search);
const simulateLive = parameters.has("live");
let recognizer: SimulatedSpeechRecognition | undefined;

class SimulatedSpeechRecognition {
  private words = "";
  onresult?: (event: { resultIndex: number; results: { transcript: string }[][] }) => void;
  onend?: () => void;
  start() { recognizer = this; this.words = ""; }
  abort() { if (recognizer === this) recognizer = undefined; }
  say(words: string) {
    this.words = words;
    this.onresult?.({ resultIndex: 0, results: [[{ transcript: words }]] });
  }
  pause() { this.onend?.(); }
  stop() { this.say(`${this.words} final words`); this.onend?.(); }
}

// Optional deterministic input for manual visual checks without microphone access.
if (parameters.has("simulated")) {
  const wav = new ArrayBuffer(44 + 8000);
  const view = new DataView(wav);
  for (const [offset, label] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    new Uint8Array(wav, offset, 4).set(new TextEncoder().encode(label));
  }
  view.setUint32(4, wav.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 8000, true);
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new MediaStream() });
  Object.defineProperty(window, "MediaRecorder", { value: class {
    state = "inactive";
    onstop?: () => void;
    ondataavailable?: (event: { data: Blob }) => void;
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([wav], { type: "audio/wav" }) });
      this.onstop?.();
    }
  } });
  const fetchRequest = window.fetch.bind(window);
  window.fetch = (input, init) => typeof input === "string" && input.endsWith("/api/voice/transcribe")
    ? Promise.resolve(Response.json({ text: "voice words" }))
    : fetchRequest(input, init);
  if (simulateLive) {
    Object.defineProperty(window, "SpeechRecognition", { value: SimulatedSpeechRecognition });
    Object.defineProperty(window, "AudioContext", { value: class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return { fftSize: 128, getByteTimeDomainData: (samples: Uint8Array) => {
          const amplitude = Math.round(19 * (1 + Math.sin(performance.now() / 360)));
          samples.forEach((_, index) => { samples[index] = index % 2 ? 128 + amplitude : 128 - amplitude; });
        }};
      }
      async resume() {}
      async close() {}
    } });
  }
}

function VoiceFixture() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sent, setSent] = useState("");
  return <main className="flex h-dvh flex-col justify-end bg-background p-3">
    {simulateLive ? <div className="mb-auto flex flex-wrap gap-3 p-2">
      <button onClick={() => recognizer?.say("first guess")}>First words</button>
      <button onClick={() => recognizer?.say("first phrase")}>Correct words</button>
      <button onClick={() => recognizer?.pause()}>Pause recognizer</button>
      <button onClick={() => recognizer?.say("second phrase")}>More words</button>
    </div> : null}
    <output data-testid="sent-voice">{sent}</output>
    <Composer activeName="Chief" artifactTarget={{ botId: "voice-fixture" }} draftKey="voice-fixture"
      running={false} sending={false} pendingAttachments={attachments} attachmentNotice={null} sendError={null}
      onOpenModels={noop} onOpenConnections={noop} runError={null} runErrorId={null}
      onRunErrorPresented={noop} onDismissError={noop} fileInputRef={fileInputRef}
      onAttachmentPick={files => {
        if (!files?.length) return false;
        setAttachments(previous => [...previous, ...Array.from(files, file => ({ id: crypto.randomUUID(), threadKey: "voice-fixture", file }))]);
        return true;
      }}
      onRemoveAttachment={item => setAttachments(previous => previous.filter(file => file.id !== item.id))}
      onSend={async text => { setSent(`${text} | ${attachments.map(item => item.file.type).join(",")}`); setAttachments([]); return true; }}
      onStop={async () => {}} dictationTranscribe enterToSend />
  </main>;
}

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}><I18nProvider i18n={i18n}><VoiceFixture /></I18nProvider></QueryClientProvider>,
  );
});
