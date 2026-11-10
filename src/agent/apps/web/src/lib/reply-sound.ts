import type { ProductEvent } from "@rakazo/contracts";
import { getGeneralPreferences } from "./general-preferences";

const DURATION = 0.2;
let audioContext: AudioContext | undefined;

/** Open the shared audio output on a gesture so mobile browsers allow later playback. */
export function unlockReplySound(): void {
  try {
    const Context = globalThis.AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new Context();
    if (audioContext.state !== "running") void audioContext.resume().catch(() => undefined);
  } catch {
    // Audio may be unavailable on this device.
  }
}

export function playReplySound(choice = getGeneralPreferences().taskSound): void {
  if (choice === "off") return;
  const context = audioContext;
  if (!context || context.state !== "running") return;
  try {
    const start = context.currentTime;
    const tone = context.createOscillator();
    const volume = context.createGain();
    const frequencies: Record<string, [number, number]> = { classic: [440, 185], default: [520, 660], mech: [1100, 120], bubble: [480, 820], press: [220, 100] };
    const [first, last] = frequencies[choice] ?? frequencies.classic!;
    tone.frequency.setValueAtTime(first, start);
    tone.frequency.exponentialRampToValueAtTime(last, start + 0.15);
    volume.gain.setValueAtTime(0.001, start);
    volume.gain.linearRampToValueAtTime(0.13, start + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.001, start + DURATION);
    tone.connect(volume).connect(context.destination);
    tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    tone.start(start);
    tone.stop(start + DURATION);
  } catch {
    // Losing the audio output cannot interrupt a chat update.
  }
}

/** Gesture-only action cues, installed once. Does not read or transmit message contents. */
export function installActionSounds(target = document) {
  const click = (event: MouseEvent) => {
    const choice = getGeneralPreferences().actionSound;
    if (choice === "off" || !(event.target instanceof Element)) return;
    const button = event.target.closest("button, [role=menuitem], [role=tab]");
    if (!button || button.hasAttribute("disabled") || button.closest("[data-sound-preview]")) return;
    unlockReplySound(); playReplySound(choice);
  };
  target.addEventListener("click", click);
  return () => target.removeEventListener("click", click);
}

/** A persisted reply and its terminal event arrive separately on the live stream. */
export function createReplySoundGate() {
  const replies = new Set<string>();
  return (
    event: Pick<ProductEvent, "type" | "runId" | "threadId" | "seq" | "payload">,
    threadId: string | undefined,
    initialCursor: number,
  ): boolean => {
    if (!event.runId || event.threadId !== threadId || event.seq <= initialCursor) return false;
    if (event.type === "thread.message.created" && event.payload.role === "bot") {
      replies.add(event.runId);
      if (replies.size > 100) replies.delete(replies.values().next().value!);
    }
    if (event.type === "run.failed" || event.type === "run.cancelled") replies.delete(event.runId);
    return event.type === "run.completed" && replies.delete(event.runId);
  };
}
