import { spawn } from "node:child_process";
import { pcmToMuLaw } from "./pcm.js";

/** Decode only bounded speech-provider bytes, never a caller-supplied path or URL. */
export function speechToMuLaw(bytes: Uint8Array, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error("Invalid speech clip.");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.MYCELLIOS_VOICE_RTC_FFMPEG ?? "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0,
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
        return;
      }
      const pcm = Buffer.concat(chunks);
      if (!pcm.length || pcm.length % 2) {
        reject(new Error("Invalid decoded speech."));
        return;
      }
      const samples = new Int16Array(pcm.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
      resolve(pcmToMuLaw(samples));
    };
    const abort = () => finish(new Error("Speech playback cancelled."));
    const timer = setTimeout(() => finish(new Error("Speech decoder timed out.")), 15000);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (part: Buffer) => {
      size += part.length;
      if (size > 8000 * 2 * 120) finish(new Error("Speech clip is too long."));
      else chunks.push(part);
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () =>
      finish(new Error("Install ffmpeg to use the local WebRTC voice trial.")),
    );
    child.on("close", (code) =>
      finish(code === 0 ? undefined : new Error("Could not decode the speech clip.")),
    );
    child.stdin.end(bytes);
  });
}
