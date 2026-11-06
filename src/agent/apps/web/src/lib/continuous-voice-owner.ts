// A phone call takes audio only after the continuous conversation releases it.
let close: (() => void) | undefined;
export function registerContinuousVoiceCloser(next: () => void) {
  close?.(); close = next;
  return () => { if (close === next) close = undefined; };
}
export function closeContinuousVoice() { const previous = close; close = undefined; previous?.(); }
