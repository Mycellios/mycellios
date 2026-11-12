import { contrastRatio } from "./bot-avatar-colors.js";
import { REST_GAZE, eyePoses } from "./bloub-eye-geometry.js";

export interface CompactMicoArt {
  crop: readonly [number, number, number];
  face: readonly [number, number];
  luminance: number;
  faceColor?: readonly [number, number, number];
  eyeScale?: number;
  collection?: "mycelium" | "growth";
}

/** Squares are centered on the alpha silhouette with at least 32 source pixels
 * of padding. Face anchors retain their absolute position in the source atlas. */
const COMPACT: Readonly<Record<number, CompactMicoArt>> = {
  1000: { crop: [43.5, 45, 480], face: [32.3333, 42.8333], luminance: 0.38, faceColor: [52, 106, 81], eyeScale: 0.92, collection: "mycelium" },
  1101: { crop: [521, 44.5, 480], face: [30.7, 42.5], luminance: 0.57, faceColor: [189, 139, 56], eyeScale: 1, collection: "mycelium" },
  1102: { crop: [1003.5, 44, 492], face: [29.7561, 41.4309], luminance: 0.45, faceColor: [108, 114, 164], eyeScale: 0.92, collection: "mycelium" },
  1103: { crop: [32.5, 521, 480], face: [37.4333, 40.4333], luminance: 0.443, faceColor: [179, 99, 86], eyeScale: 1, collection: "mycelium" },
  1104: { crop: [509, 526.5, 480], face: [31.8333, 40], luminance: 0.405, faceColor: [134, 91, 109], eyeScale: 1, collection: "mycelium" },
  1105: { crop: [981.5, 527, 520], face: [26.1846, 36.5846], luminance: 0.56, faceColor: [129, 145, 104], eyeScale: 1, collection: "mycelium" },
  1106: { crop: [18, 17.5, 502], face: [38.2789, 44.3028], luminance: 0.43, faceColor: [52, 107, 96], eyeScale: 0.95, collection: "growth" },
  1107: { crop: [512.5, 25, 496], face: [31.9677, 31.871], luminance: 0.40, faceColor: [153, 71, 67], eyeScale: 1, collection: "growth" },
  1108: { crop: [1000.5, 23.5, 526], face: [32.1217, 27.4068], luminance: 0.60, faceColor: [174, 136, 88], eyeScale: 0.92, collection: "growth" },
  1109: { crop: [8.5, 516, 496], face: [22.9677, 32.5161], luminance: 0.42, faceColor: [76, 79, 125], eyeScale: 0.92, collection: "growth" },
  1110: { crop: [490, 498.5, 532], face: [32.5113, 38.9474], luminance: 0.57, faceColor: [183, 99, 85], eyeScale: 1, collection: "growth" },
  1111: { crop: [1026.5, 516, 496], face: [30.7097, 33.5161], luminance: 0.51, faceColor: [124, 99, 136], eyeScale: 0.95, collection: "growth" },
  1001: { crop: [556, 63, 416], face: [40.6, 30.8], luminance: 0.45 },
  1004: { crop: [1041, 56, 432], face: [36.9, 29.5], luminance: 0.4445 },
  1005: { crop: [47, 542, 432], face: [48.3, 29], luminance: 0.3775 },
  1007: { crop: [540, 543, 440], face: [52.2, 29.8], luminance: 0.4966 },
  1008: { crop: [1027, 540, 456], face: [39.8, 29.8], luminance: 0.3867 },
};

export function compactMicoArt(shapeIndex: number | undefined): CompactMicoArt | undefined {
  return shapeIndex === undefined ? undefined : COMPACT[shapeIndex];
}

/** Original Bloub felt-pad calibration; Mycellios uses its own compact frontal proportions. */
const RADIUS = 25.6;
const REST_EYES = eyePoses(REST_GAZE, RADIUS);
const CENTER_X = (REST_EYES[0].x + REST_EYES[1].x) / 2;
const CENTER_Y = (REST_EYES[0].y + REST_EYES[1].y) / 2;
export const COMPACT_EYE_WIDTH = 3.2;
export const COMPACT_EYE_HEIGHT = 7.2;
export const COMPACT_EYE_PAD = {
  kw: 1.7586780224155572 / 0.46,
  kh: (1.667393362265376 - (0.5 - 0.46)) / 0.46,
};

export function compactMicoEyes(art: CompactMicoArt) {
  // These bodies face forward. A spherical tangent projection would slant and
  // shorten one eye differently from the other on an otherwise frontal face.
  if (art.collection) {
    const scale = art.eyeScale ?? 1;
    return [-1, 1].map(side => ({
      x: art.face[0] + side * 4 * scale,
      y: art.face[1],
      matrix: `matrix(${scale} 0 0 ${scale} 0 0)`,
      scale,
    }));
  }
  return REST_EYES.map((eye) => ({
    scale: 1,
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


/** One felt ink throughout the family; only very pale faces need dark eyes.
 * Sampled face colors belong to the eyeless atlas, not the nominal palette.
 * Reproduce the renderer's luminance tint at the face before choosing contrast.
 */
export function compactMicoEyeColor(color: string, art: CompactMicoArt, original = false, native = false) {
  const expanded = color.length === 4 ? color.slice(1).split("").map(c => c + c).join("") : color.slice(1);
  const channels = [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  let face: number[] = art.faceColor ? art.faceColor.map(c => c / 255) : channels;
  if (!original) {
    const luminance = face[0]! * 0.2126 + face[1]! * 0.7152 + face[2]! * 0.0722;
    const level = Math.max(0, Math.min(1, luminance * 0.5 / art.luminance));
    face = channels.map(channel => {
      if (native) return Math.max(0, Math.min(1, luminance * channel / art.luminance));
      const table = [0, channel / 2, channel, (channel + 1) / 2, 1];
      const index = Math.min(3, Math.floor(level * 4));
      const blend = level * 4 - index;
      return table[index]! * (1 - blend) + table[index + 1]! * blend;
    });
  }
  const fill = "#" + face.map(channel => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
  return contrastRatio(fill, "#F4F0E4") >= 2.2 ? "#F4F0E4" : "#1D2B23";
}
