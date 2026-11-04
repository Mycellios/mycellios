/** G.711 mu-law is mandatory WebRTC narrowband audio; no native codec dependency. */
export function decodeMuLaw(bytes: Uint8Array): Int16Array {
  return Int16Array.from(bytes, (value) => {
    const code = ~value & 255;
    const magnitude = (((code & 15) << 3) + 132) << ((code >> 4) & 7);
    return code & 128 ? 132 - magnitude : magnitude - 132;
  });
}
export function muLawSample(value: number): number {
  const sign = value < 0 ? 128 : 0;
  const sample = Math.min(32635, Math.abs(value)) + 132;
  let exponent = 7;
  for (let mask = 16384; exponent > 0 && !(sample & mask); mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 15;
  return ~(sign | (exponent << 4) | mantissa) & 255;
}
export function pcmToMuLaw(samples: Int16Array): Buffer {
  return Buffer.from(Array.from(samples, muLawSample));
}
export function wav8k(samples: readonly number[]): Uint8Array {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });
  return buffer;
}

/** Bounded server-side turn detector. UI timers never decide when a spoken turn ends. */
export class VoiceTurnDetector {
  private samples: number[] = [];
  private spoken = 0;
  private quiet = 0;
  push(pcm: Int16Array): number[] | undefined {
    const rms = Math.sqrt(
      pcm.reduce((sum, value) => sum + value * value, 0) / Math.max(1, pcm.length),
    );
    if (rms > 900) {
      this.spoken += pcm.length;
      this.quiet = 0;
    } else if (this.spoken) this.quiet += pcm.length;
    if (this.spoken) this.samples.push(...pcm);
    if (this.samples.length > 8000 * 12) return this.finish();
    if (this.spoken >= 1600 && this.quiet >= 8000) return this.finish();
    if (this.spoken && this.quiet >= 16000) this.reset();
  }
  reset() {
    this.samples = [];
    this.spoken = 0;
    this.quiet = 0;
  }
  private finish() {
    const result = this.samples.slice(0, 8000 * 12);
    this.reset();
    return result;
  }
}
