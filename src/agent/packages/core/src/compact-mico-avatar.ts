import { EYE_H, EYE_W, REST_GAZE, eyePoses } from "./bloub-eye-geometry.js";

export interface CompactMicoArt {
  crop: readonly [number, number, number];
  face: readonly [number, number];
  luminance: number;
}

/** Sprite coordinates and face anchors belong to the approved eyeless artwork. */
const COMPACT: Readonly<Record<number, CompactMicoArt>> = {
  1000: { crop: [54, 55, 432], face: [39.9, 25.4], luminance: 0.5454 },
  1001: { crop: [556, 63, 416], face: [40.6, 30.8], luminance: 0.45 },
  1004: { crop: [1041, 56, 432], face: [36.9, 29.5], luminance: 0.4445 },
  1005: { crop: [47, 542, 432], face: [48.3, 29], luminance: 0.3775 },
  1007: { crop: [540, 543, 440], face: [52.2, 29.8], luminance: 0.4966 },
  1008: { crop: [1027, 540, 456], face: [39.8, 29.8], luminance: 0.3867 },
};

export function compactMicoArt(shapeIndex: number | undefined): CompactMicoArt | undefined {
  return shapeIndex === undefined ? undefined : COMPACT[shapeIndex];
}

/** Neutral proportions, tangent projection and felt pad used by Bloub/OpenBot. */
const RADIUS = 25.6;
const REST_EYES = eyePoses(REST_GAZE, RADIUS);
const CENTER_X = (REST_EYES[0].x + REST_EYES[1].x) / 2;
const CENTER_Y = (REST_EYES[0].y + REST_EYES[1].y) / 2;
export const COMPACT_EYE_WIDTH = EYE_W * RADIUS;
export const COMPACT_EYE_HEIGHT = EYE_H * RADIUS;
export const COMPACT_EYE_PAD = {
  kw: 1.7586780224155572 / 0.46,
  kh: (1.667393362265376 - (0.5 - 0.46)) / 0.46,
};

export function compactMicoEyes(art: CompactMicoArt) {
  return REST_EYES.map((eye) => ({
    x: art.face[0] + eye.x - CENTER_X,
    y: art.face[1] + eye.y - CENTER_Y,
    matrix: `matrix(${eye.a} ${eye.b} ${eye.c} ${eye.d} 0 0)`,
  }));
}

/** Recolor luminance, preserving the velvet's shade/highlight and original alpha. */
export function compactMicoTint(color: string, art: CompactMicoArt) {
  const hex = /^#[\da-f]{3}$/i.test(color)
    ? color.slice(1).split("").map((c) => c + c).join("")
    : color.slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const gain = 0.5 / art.luminance;
  const row = [0.2126, 0.7152, 0.0722].map((v) => v * gain).join(" ");
  return {
    matrix: `${row} 0 0 ${row} 0 0 ${row} 0 0 0 0 0 1 0`,
    tables: channels.map((v) => [0, v / 2, v, (v + 1) / 2, 1].join(" ")),
  };
}
