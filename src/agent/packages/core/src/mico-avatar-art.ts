import {
  MICO_AVATAR_DEFAULT_SHAPES,
  MICO_AVATAR_SHAPES,
  micoAvatarDefaultFinish,
  micoAvatarShape,
  micoAvatarValue,
  parseBotAvatarValue,
} from "@rakazo/contracts";
import { avatarIdentitySeed } from "./avatar-shape.js";
import { contrastRatio, resolvePersonaColorDef } from "./bot-avatar-colors.js";

/** Display legacy avatars with the current collection without rewriting their stored value. */
export function currentMicoAvatarValue(value: string, identity?: string): string {
  const parsed = parseBotAvatarValue(value);
  if (parsed.kind === "image" || (parsed.kind === "shape" && micoAvatarShape(parsed.shapeIndex))) {
    return value;
  }
  const seed = identity || value || "mico";
  const fallback = MICO_AVATAR_DEFAULT_SHAPES[avatarIdentitySeed(seed) % MICO_AVATAR_DEFAULT_SHAPES.length]!;
  const shape = parsed.kind === "shape" ? MICO_AVATAR_SHAPES[parsed.shapeIndex] ?? fallback : fallback;
  const color = resolvePersonaColorDef(seed, parsed.kind === "other" ? undefined : parsed.color).hex;
  return micoAvatarValue(shape.index, color, { eyes: 0, finish: micoAvatarDefaultFinish(shape.index), original: false });
}

type MicoArt = {
  path: string;
  eyes: readonly (readonly [x: number, y: number, width: number, height: number])[];
  nose?: string;
};

export const MICO_AVATAR_VIEWBOX = "0 0 64 64";
export const MICO_AVATAR_EYE_COLOR = "#1D2B23";

// Solid silhouettes and capsule eyes follow the Mycellios loading mark.
const art: Record<NonNullable<ReturnType<typeof micoAvatarShape>>["id"], MicoArt> = {
  mushroom: {
    path: "M26 30h12l3 21c.5 3.5-2 6-5.5 6h-7c-3.5 0-6-2.5-5.5-6l3-21ZM6 28C7 16 18 7 32 7s25 9 26 21c.3 4-2.5 7-6.5 7h-39C8.5 35 5.7 32 6 28Z",
    eyes: [[26, 40, 3.5, 8], [34.5, 40, 3.5, 8]],
  },
  owl: {
    path: "M10 16c-1-5 3-7 7-4l8 5c5-2 9-2 14 0l8-5c4-3 8-1 7 4l-2 12c4 7 5 14 2 20-3 7-12 10-22 10s-19-3-22-10c-3-6-2-13 2-20Z",
    eyes: [[21, 31, 4, 8], [39, 31, 4, 8]],
  },
  crab: {
    path: "M18 37 8 41c-5 2-3 7 1 6l10-4-7 8c-3 4 1 8 5 5l10-10h10l10 10c4 3 8-1 5-5l-7-8 10 4c4 1 6-4 1-6l-10-4Z",
    eyes: [[22, 32, 4, 8], [38, 32, 4, 8]],
  },
  fox: {
    path: "M7 30 9 10Q9 7 12 9L25 19Q33 17 39 19L52 9Q55 7 55 11L57 30C59 43 51 47 44 50L35 57Q32 59 28 56L19 50C11 47 5 42 7 30Z",
    eyes: [[22, 31, 4, 8], [38, 31, 4, 8]],
  },
  turtle: {
    path: "M6 38C6 25 15 15 27 15c10 0 18 5 22 15 1-4 3-6 7-6 5 0 7 4 6 8-1 6-5 9-12 10l-2 7c-1 4-8 5-10 1l-2-6H22l-2 6c-2 4-10 3-11-1L7 44Q2 45 3 42Z",
    eyes: [[54, 29, 3.3, 6.2]],
  },
  hedgehog: {
    path: "M6 44 4 36q-1-3 2-4l4-1-2-6q-1-3 2-3l6 1 1-8q0-3 3-2l6 3 4-7q2-2 4 0l4 7 7-3q3-1 3 2l1 8q5 2 8 8l5 4q2 3-1 6l-8 3-3 7q-1 4-6 4H18C11 55 7 51 6 44Z",
    eyes: [[45, 32, 3.4, 7]],
  },
  snail: {
    path: "M10 43C1 34 6 17 17 13 30 8 44 16 44 30l3-9-2-7c-2-5 5-7 6-3l3 8 4-7c2-4 8-1 5 3l-5 8c6 5 6 14 2 20-5 7-11 10-23 10H9q-6 0-6-4t7-6Z",
    eyes: [[51, 28, 3.2, 7], [57, 28, 3.2, 7]],
  },
  fish: {
    path: "M16 24c5-8 13-11 22-10l5-5q3-2 4 1l2 8 10 10c5 5 5 10 0 15-6 7-13 9-22 9-11 0-18-4-23-10l-8 5q-5 3-4-3l2-11-2-11q-1-6 4-3Z",
    eyes: [[48, 30, 3.8, 8]],
  },
  axolotl: {
    path: "M16 21Q8 11 6 15t4 10Q2 21 1 26t8 9Q1 34 2 39t11 4c4 7 11 11 19 11s15-4 19-11q10 1 11-4t-7-4q9-4 8-9t-9-1q6-6 4-10t-10 6C39 16 25 16 16 21Z",
    eyes: [[23, 32, 4, 8], [37, 32, 4, 8]],
  },
  octopus: {
    path: "M12 35C7 22 17 8 32 8s25 14 20 27c6 2 10 6 10 11 0 7-9 10-14 5-2 7-11 8-16 3-5 5-14 4-16-3C11 56 2 53 2 46c0-5 4-9 10-11Z",
    eyes: [[23, 27, 4, 8], [37, 27, 4, 8]],
  },
  frog: {
    path: "M8 30C3 22 7 13 15 12c6-1 10 3 12 7h10c2-4 6-8 12-7 8 1 12 10 7 18 4 4 6 9 5 14-2 8-11 12-29 12S5 52 3 44c-1-5 1-10 5-14Z",
    eyes: [[15, 21, 4, 8], [45, 21, 4, 8]],
  },
  moth: {
    path: "M26 19c-4-6-9-7-12-8-5-1-4-6 0-6 6 0 12 5 16 11h4c4-6 10-11 16-11 4 0 5 5 0 6-3 1-8 2-12 8 13 5 23 16 24 24 2 10-9 12-17 7-2 8-10 10-13 3-3 7-11 5-13-3-8 5-19 3-17-7 1-8 11-19 24-24Z",
    eyes: [[26, 24, 3.1, 6.8], [35, 24, 3.1, 6.8]],
  },
  raven: {
    path: "M9 41c2-8 6-13 10-16C20 14 29 8 40 10c6 0 10 3 14 8 6 2 10 6 9 13l-11-3c-1 14-9 20-23 20L8 55q-5 1-4-3Z",
    eyes: [[43, 19, 3.4, 7]],
  },
  hare: {
    path: "M13 38c-5-6-8-20-6-27 1-5 6-6 10-2 5 5 9 16 10 21l7-1c0-10 2-22 7-25 4-3 8-1 9 4 2 8-1 18-4 25 8 5 12 12 8 18-3 6-12 9-22 9-16 0-27-10-19-22Z",
    eyes: [[25, 40, 4, 8], [39, 40, 4, 8]],
  },
  otter: {
    path: "M10 24c-5-4-3-12 3-13 4-1 7 1 9 3 7-3 13-3 20 0 2-2 5-4 9-3 6 1 8 9 3 13 4 5 7 11 6 17-1 10-11 16-28 16S5 51 4 41c-1-6 2-12 6-17Z",
    eyes: [[18, 29, 4, 8], [42, 29, 4, 8]],
    nose: "M28 37q4-2 8 0 1 1-1 3l-2 2q-1 1-2 0l-2-2q-2-2-1-3Z",
  },
};

export function micoAvatarArt(shapeIndex: number, color: string) {
  const shape = micoAvatarShape(shapeIndex);
  if (!shape) return undefined;
  const fill = resolvePersonaColorDef(shape.id, color).hex;
  const white = "#FFFFFF";
  const eyeColor =
    contrastRatio(fill, white) > contrastRatio(fill, MICO_AVATAR_EYE_COLOR)
      ? white
      : MICO_AVATAR_EYE_COLOR;
  return { ...art[shape.id], color: fill, eyeColor };
}
