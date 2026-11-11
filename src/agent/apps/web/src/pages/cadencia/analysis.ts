export const ANALYSIS_RATE = 16000;
export const MAX_DURATION = 300;
export const MAX_FILE_BYTES = 250 * 1024 * 1024;
export type Cut = {
  id: string;
  kind: "silence" | "vowel";
  start: number;
  end: number;
  enabled: boolean;
};
export type Settings = {
  minimumSilence: number;
  margin: number;
  minimumVowel: number;
};
export const DEFAULT_SETTINGS: Settings = {
  minimumSilence: 0.35,
  margin: 0.08,
  minimumVowel: 0.7,
};
export type Analysis = {
  cuts: Cut[];
  peaks: number[];
  thresholdDb: number;
  duration: number;
};
export type Segment = { start: number; end: number; output: number };

function crossing(pcm: Float32Array, at: number, direction: number) {
  const center = Math.round(at * ANALYSIS_RATE),
    radius = 80;
  let best = Math.max(0, Math.min(pcm.length - 1, center)),
    score = Infinity;
  for (
    let i = Math.max(1, center - radius);
    i < Math.min(pcm.length, center + radius);
    i++
  ) {
    if ((i - center) * direction < 0) continue;
    const value = Math.abs(pcm[i]!) + Math.abs(pcm[i - 1]!);
    if (value < score) {
      score = value;
      best = i;
    }
  }
  return best / ANALYSIS_RATE;
}

// Deliberately conservative acoustic candidates, not a transcription or a word aligner.
export function analyze(
  pcm: Float32Array,
  settings: Settings = DEFAULT_SETTINGS,
  progress?: (value: number) => void,
): Analysis {
  if (
    !pcm.length ||
    pcm.length > MAX_DURATION * ANALYSIS_RATE ||
    pcm.some((x) => !Number.isFinite(x))
  )
    throw new Error("Audio inválido o demasiado largo.");
  if (
    ![settings.minimumSilence, settings.margin, settings.minimumVowel].every(
      Number.isFinite,
    ) ||
    settings.minimumSilence < 0.2 ||
    settings.minimumSilence > 2 ||
    settings.margin < 0.02 ||
    settings.margin > 0.2 ||
    settings.minimumVowel < 0.5 ||
    settings.minimumVowel > 2
  )
    throw new Error("Ajustes fuera del intervalo permitido.");
  const duration = pcm.length / ANALYSIS_RATE;
  const hop = 160,
    energy: number[] = [],
    peaks: number[] = [];
  for (let i = 0; i < pcm.length; i += hop) {
    let sum = 0;
    for (let j = i; j < Math.min(i + hop, pcm.length); j++) sum += pcm[j]! ** 2;
    energy.push(Math.sqrt(sum / Math.min(hop, pcm.length - i)));
  }
  const sorted = energy.slice().sort((a, b) => a - b);
  const threshold = Math.max(
    0.0015,
    Math.min(0.009, sorted[Math.floor(sorted.length * 0.12)]! * 2.5),
  );
  for (let bucket = 0; bucket < 640; bucket++) {
    const start = Math.floor((bucket * energy.length) / 640),
      end = Math.max(
        start + 1,
        Math.floor(((bucket + 1) * energy.length) / 640),
      );
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, energy[i] ?? 0);
    peaks.push(peak);
  }
  const cuts: Cut[] = [];
  // Require non-quiet content: never erase an entirely silent/very quiet recording.
  if (sorted[Math.floor(sorted.length * 0.95)]! > threshold * 2) {
    for (let i = 0; i < energy.length;) {
      if (energy[i]! > threshold) {
        i++;
        continue;
      }
      const first = i;
      while (i < energy.length && energy[i]! <= threshold) i++;
      const start = first * 0.01,
        end = Math.min(duration, i * 0.01);
      if (
        end - start >= settings.minimumSilence &&
        end - start > settings.margin * 2 + 0.06
      ) {
        cuts.push({
          id: `s-${first}`,
          kind: "silence",
          start: crossing(pcm, start + settings.margin, 1),
          end: crossing(pcm, end - settings.margin, -1),
          enabled: true,
        });
      }
    }
  }
  progress?.(0.2);
  const frame = new Float32Array(160);
  let anchor: { pitch: number; spectrum: number[]; rms: number } | null = null,
    runStart = 0,
    last = 0;
  const close = () => {
    if (anchor && last - runStart >= settings.minimumVowel) {
      const start = runStart + 0.16,
        end = last - 0.16;
      if (
        end - start >= 0.2 &&
        !cuts.some((c) => c.start < end && c.end > start)
      )
        cuts.push({
          id: `v-${Math.round(runStart * 100)}`,
          kind: "vowel",
          start: crossing(pcm, start, 1),
          end: crossing(pcm, end, -1),
          enabled: false,
        });
    }
    anchor = null;
  };
  for (let offset = 0; offset + 640 < pcm.length; offset += 320) {
    const at = offset / ANALYSIS_RATE;
    let mean = 0;
    for (let i = 0; i < 160; i++) {
      frame[i] = pcm[offset + i * 4]!;
      mean += frame[i]!;
    }
    mean /= 160;
    let power = 0;
    for (let i = 0; i < 160; i++) {
      frame[i] = frame[i]! - mean;
      power += frame[i]! ** 2;
    }
    const rms = Math.sqrt(power / 160);
    if (rms < threshold * 2 || power < 1e-8) {
      close();
      continue;
    }
    let correlation = 0,
      lag = 0;
    for (let candidate = 10; candidate <= 57; candidate++) {
      let dot = 0,
        left = 0,
        right = 0;
      for (let i = candidate; i < 160; i++) {
        const x = frame[i]!,
          y = frame[i - candidate]!;
        dot += x * y;
        left += x * x;
        right += y * y;
      }
      const value = dot / Math.sqrt(left * right + 1e-12);
      if (value > correlation + 0.015) {
        correlation = value;
        lag = candidate;
      }
    }
    if (correlation < 0.82 || !lag) {
      close();
      continue;
    }
    const spectrum = [250, 500, 1000, 1500].map((f) => {
      const coefficient = 2 * Math.cos((2 * Math.PI * f) / 4000);
      let one = 0,
        two = 0;
      for (let i = 0; i < 160; i++) {
        const next = frame[i]! + coefficient * one - two;
        two = one;
        one = next;
      }
      return (
        Math.sqrt(
          Math.max(0, one * one + two * two - coefficient * one * two),
        ) / Math.sqrt(power)
      );
    });
    const pitch = 4000 / lag;
    const cosine = anchor
      ? spectrum.reduce((sum, x, i) => sum + x * anchor!.spectrum[i]!, 0) /
        Math.sqrt(
          spectrum.reduce((s, x) => s + x * x, 0) *
            anchor.spectrum.reduce((s, x) => s + x * x, 0) +
            1e-12,
        )
      : 1;
    if (
      anchor &&
      (Math.abs(pitch / anchor.pitch - 1) > 0.13 ||
        cosine < 0.91 ||
        Math.abs(20 * Math.log10(rms / anchor.rms)) > 7)
    )
      close();
    if (!anchor) {
      anchor = { pitch, spectrum, rms };
      runStart = at;
    }
    last = at + 0.04;
    if (offset % 16000 === 0) progress?.(0.2 + (0.8 * offset) / pcm.length);
  }
  close();
  return {
    cuts: cuts.sort((a, b) => a.start - b.start).slice(0, 120),
    peaks,
    thresholdDb: 20 * Math.log10(threshold),
    duration,
  };
}

export function selectedCuts(
  cuts: Cut[],
  duration: number,
): Array<{ start: number; end: number }> {
  const ordered = cuts
    .filter((c) => c.enabled)
    .map((c) => {
      if (
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.end > duration + 0.00001 ||
        c.end - c.start < 0.005
      )
        throw new Error(
          "Revisa el inicio y el final de los cortes seleccionados.",
        );
      return { start: c.start, end: Math.min(c.end, duration) };
    })
    .sort((a, b) => a.start - b.start);
  const merged: typeof ordered = [];
  for (const cut of ordered) {
    const previous = merged.at(-1);
    if (previous && cut.start <= previous.end)
      previous.end = Math.max(previous.end, cut.end);
    else merged.push({ ...cut });
  }
  if (duration - merged.reduce((sum, c) => sum + c.end - c.start, 0) < 0.08)
    throw new Error("Conserva al menos un fragmento del original.");
  return merged;
}

export function keptSegments(cuts: Cut[], duration: number): Segment[] {
  const selected = selectedCuts(cuts, duration),
    segments: Segment[] = [];
  let cursor = 0,
    output = 0;
  for (const cut of [...selected, { start: duration, end: duration }]) {
    if (cut.start > cursor) {
      segments.push({ start: cursor, end: cut.start, output });
      output += cut.start - cursor;
    }
    cursor = cut.end;
  }
  return segments;
}

export function sourceTime(segments: Segment[], time: number) {
  const segment =
    segments.find((s) => time < s.output + s.end - s.start) ?? segments.at(-1);
  if (!segment) return 0;
  return Math.min(
    segment.end,
    segment.start + Math.max(0, time - segment.output),
  );
}

export function auditionPcm(
  pcm: Float32Array,
  start: number,
  end: number,
  cuts: Cut[],
): Float32Array {
  const duration = pcm.length / ANALYSIS_RATE;
  start = Math.max(0, start);
  end = Math.min(duration, end);
  if (end <= start) throw new Error("El fragmento no tiene duración.");
  const clipped = cuts
    .filter((c) => c.enabled && c.start < end && c.end > start)
    .map((c) => ({
      ...c,
      start: Math.max(c.start, start) - start,
      end: Math.min(c.end, end) - start,
    }));
  const spans = keptSegments(clipped, end - start);
  const arrays = spans.map((s) =>
    pcm.slice(
      Math.round((start + s.start) * ANALYSIS_RATE),
      Math.round((start + s.end) * ANALYSIS_RATE),
    ),
  );
  const result = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    const fade = Math.min(80, Math.floor(a.length / 2));
    for (let i = 0; i < fade; i++) {
      a[i] = (a[i]! * i) / fade;
      a[a.length - 1 - i] = (a[a.length - 1 - i]! * i) / fade;
    }
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}
