/** Convert locally, before upload. The inference worker accepts only bounded PCM. */
export function transcriptionWav(samples: Float32Array): Blob {
  if (!samples.length || samples.length > 480_000) throw new Error("Record up to 30 seconds for Mycellios dictation.");
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) {
    new Uint8Array(buffer, offset, text.length).set(new TextEncoder().encode(text));
  }
  view.setUint32(4, buffer.byteLength - 8, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    if (!Number.isFinite(value)) throw new Error("Invalid recording samples.");
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + index * 2, sample * (sample < 0 ? 32768 : 32767), true);
  });
  return new Blob([buffer], { type: "audio/wav" });
}
export async function prepareNetworkTranscriptionAudio(blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error("Recording is empty or too large.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 30 || decoded.duration <= 0) throw new Error("Record up to 30 seconds for Mycellios dictation.");
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    return transcriptionWav((await offline.startRendering()).getChannelData(0));
  } finally { await context.close(); }
}
