import { expect, it } from "vitest";
import { transcriptionWav } from "./transcription-audio";
it("creates canonical mono 16 kHz WAV, clipping safely", async () => {
  const wav = transcriptionWav(new Float32Array([-2, 0, 2]));
  const bytes = await wav.arrayBuffer(), view = new DataView(bytes);
  expect(wav.type).toBe("audio/wav"); expect(bytes.byteLength).toBe(50);
  expect(view.getUint32(24, true)).toBe(16000); expect(view.getUint16(22, true)).toBe(1);
  expect(view.getInt16(44, true)).toBe(-32768); expect(view.getInt16(48, true)).toBe(32767);
});
it("rejects empty, non-finite and over 30 second recordings instead of truncating", () => {
  for (const samples of [new Float32Array(), new Float32Array([NaN]), new Float32Array(480001)]) {
    expect(() => transcriptionWav(samples)).toThrow();
  }
});
