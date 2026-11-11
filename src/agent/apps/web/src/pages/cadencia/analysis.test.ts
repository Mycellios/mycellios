import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RATE,
  DEFAULT_SETTINGS,
  analyze,
  auditionPcm,
  frameTime,
  keptSegments,
  selectedCuts,
  sourceTime,
  type Cut,
} from "./analysis";

function tone(seconds: number, pitch = 130) {
  return Float32Array.from(
    { length: Math.round(seconds * ANALYSIS_RATE) },
    (_, i) =>
      0.2 * Math.sin((2 * Math.PI * pitch * i) / ANALYSIS_RATE) +
      0.1 * Math.sin((2 * Math.PI * pitch * 2 * i) / ANALYSIS_RATE),
  );
}
function recording(...parts: Float32Array[]) {
  const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    pcm.set(p, at);
    at += p.length;
  }
  return pcm;
}
const cut = (start: number, end: number, enabled = true): Cut => ({
  id: `${start}:${end}`,
  kind: "silence",
  start,
  end,
  enabled,
});
function demoPcm() {
  const wav = readFileSync(
    new URL("../../../public/cadencia/demo.wav", import.meta.url),
  );
  let offset = 12;
  while (wav.toString("ascii", offset, offset + 4) !== "data") {
    const size = wav.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  const size = wav.readUInt32LE(offset + 4);
  return Float32Array.from(
    { length: size / 2 },
    (_, i) => wav.readInt16LE(offset + 8 + i * 2) / 32768,
  );
}

describe("Cadencia acoustic proposals", () => {
  it("removes the center of long quiet gaps, preserving voice margins and short pauses", () => {
    const pcm = recording(
      tone(0.25),
      new Float32Array(16000),
      tone(0.25),
      new Float32Array(1600),
      tone(0.25),
    );
    const result = analyze(pcm),
      silences = result.cuts.filter((c) => c.kind === "silence");
    expect(silences).toHaveLength(1);
    expect(silences[0]!.start).toBeCloseTo(0.33, 2);
    expect(silences[0]!.end).toBeCloseTo(1.17, 2);
    expect(silences[0]!.enabled).toBe(true);
  });
  it("retains a completely silent or very quiet file instead of erasing it", () => {
    expect(analyze(new Float32Array(32000)).cuts).toEqual([]);
    expect(
      analyze(Float32Array.from(tone(1), (x) => x * 0.00001)).cuts,
    ).toEqual([]);
  });
  it("flags sustained periodic sound but leaves it unselected for human review", () => {
    const result = analyze(tone(1.2));
    const vowels = result.cuts.filter((c) => c.kind === "vowel");
    expect(vowels.length).toBeGreaterThan(0);
    expect(
      vowels.every((c) => !c.enabled && c.start >= 0.15 && c.end <= 1.05),
    ).toBe(true);
  });
  it("does not join short different voiced syllables into one long vowel", () => {
    const pcm = recording(
      tone(0.2, 130),
      tone(0.2, 185),
      tone(0.2, 105),
      tone(0.2, 220),
      tone(0.2, 140),
    );
    expect(analyze(pcm).cuts.filter((c) => c.kind === "vowel")).toEqual([]);
  });
  it("detects the known pauses and synthetic sustained vowel in the actual shipped voice demo", () => {
    const pcm = demoPcm();
    const result = analyze(pcm);
    expect(result.duration).toBeCloseTo(10.8781875, 5);
    expect(
      result.cuts.some(
        (c) =>
          c.kind === "silence" &&
          c.start > 1.8 &&
          c.start < 2.1 &&
          c.end > 2.65,
      ),
    ).toBe(true);
    expect(
      result.cuts.some(
        (c) => c.kind === "silence" && c.start > 7.6 && c.end < 8.55,
      ),
    ).toBe(true);
    expect(
      result.cuts.some(
        (c) => c.kind === "vowel" && c.start > 6.6 && c.end < 7.7 && !c.enabled,
      ),
    ).toBe(true);
    expect(result.peaks).toHaveLength(640);
  });
  it("rejects non-finite samples, overlong media and invalid detector settings", () => {
    expect(() => analyze(new Float32Array([NaN]))).toThrow();
    expect(() => analyze(new Float32Array(16000 * 301))).toThrow();
    expect(() =>
      analyze(tone(0.1), { ...DEFAULT_SETTINGS, margin: 0 }),
    ).toThrow();
  });
});

describe("Cadencia non-destructive timeline", () => {
  it("merges overlapping selections without counting the same time twice", () => {
    expect(
      selectedCuts([cut(1, 2), cut(1.5, 3), cut(3, 4), cut(0, 0.5, false)], 5),
    ).toEqual([{ start: 1, end: 4 }]);
    expect(keptSegments([cut(1, 2), cut(1.5, 3)], 5)).toEqual([
      { start: 0, end: 1, output: 0 },
      { start: 3, end: 5, output: 1 },
    ]);
  });
  it("maps edited time to the same original source time for video and audio", () => {
    const segments = keptSegments([cut(1, 2), cut(3, 4)], 5);
    expect(sourceTime(segments, 0.5)).toBe(0.5);
    expect(sourceTime(segments, 1)).toBe(2);
    expect(sourceTime(segments, 2)).toBe(4);
    expect(sourceTime(segments, 100)).toBe(5);
  });
  it("rejects invalid selections and removal of the entire recording", () => {
    for (const cuts of [
      [cut(-1, 1)],
      [cut(1, 1)],
      [cut(2, 1)],
      [cut(0, Infinity)],
      [cut(0, 4)],
      [cut(0, 3)],
    ])
      expect(() => selectedCuts(cuts, 3)).toThrow();
  });
  it("auditions real selected cuts at sample resolution, preserves the input and fades joins", () => {
    const pcm = Float32Array.from({ length: 32000 }, () => 0.5),
      saved = pcm.slice();
    const before = auditionPcm(pcm, 0, 2, []),
      after = auditionPcm(pcm, 0, 2, [cut(0.5, 1)]);
    expect(before.length).toBe(32000);
    expect(after.length).toBe(24000);
    expect(after[0]).toBe(0);
    expect(after[7999]).toBe(0);
    expect(after[8000]).toBe(0);
    expect(pcm).toEqual(saved);
  });
  it("restoring all selections leaves the full original timeline", () => {
    expect(keptSegments([cut(1, 2, false)], 3)).toEqual([
      { start: 0, end: 3, output: 0 },
    ]);
  });
});

describe("picture bounds on the unchanged audio timeline", () => {
  it("holds the first picture during negative Opus preroll without shifting later cut mapping", () => {
    const segments = keptSegments([cut(1, 2)], 4);
    const origin = -0.0065;
    expect(frameTime(origin + sourceTime(segments, 0), 0, 3.9)).toBe(0);
    expect(frameTime(origin + sourceTime(segments, 1.2), 0, 3.9)).toBeCloseTo(2.1935);
  });
  it("holds the final picture for a longer audio tail, within the actual final frame interval", () => {
    const requested = sourceTime(keptSegments([], 4), 3.99);
    const actual = frameTime(requested, 0.01, 3.875);
    expect(actual).toBeGreaterThan(3.874);
    expect(actual).toBeLessThan(3.875);
  });
  it("rejects missing or invalid picture ranges rather than manufacturing interior frames", () => {
    expect(() => frameTime(0, 0, 0)).toThrow();
    expect(() => frameTime(1, NaN, 2)).toThrow();
    expect(() => frameTime(Infinity, 0, 2)).toThrow();
  });
});
