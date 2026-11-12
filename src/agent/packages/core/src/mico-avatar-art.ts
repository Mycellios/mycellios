import {
  MICO_AVATAR_DEFAULT_SHAPES,
  MICO_AVATAR_SHAPES,
  micoAvatarDefaultFinish,
  micoAvatarShape,
  micoAvatarDisplayShape,
  micoAvatarDetails,
  micoAvatarValue,
  parseBotAvatarValue,
} from "@rakazo/contracts";
import { avatarIdentitySeed } from "./avatar-shape.js";
import { contrastRatio, resolvePersonaColorDef } from "./bot-avatar-colors.js";

/** Display legacy avatars with the current collection without rewriting their stored value. */
export function currentMicoAvatarValue(value: string, identity?: string): string {
  const parsed = parseBotAvatarValue(value);
  if (parsed.kind === "image") return value;
  if (parsed.kind === "shape" && micoAvatarShape(parsed.shapeIndex)) {
    const display = micoAvatarDisplayShape(parsed.shapeIndex);
    if (display && display.index !== parsed.shapeIndex) return micoAvatarValue(display.index, parsed.color, {
      ...micoAvatarDetails(value), finish: "plush",
    });
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

// Flat alternatives follow the current mycelium bodies; the historical loading mark is separate.
const art: Record<(typeof MICO_AVATAR_SHAPES)[number]["id"], MicoArt> = {
  mushroom: {
    path: "M7 34C5 31 7 25 11 19C16 11 24 7 32 7s16 4 21 12c4 6 6 12 4 15-2 4-9 5-14 5v9c0 7-4 9-11 9s-11-2-11-9v-9c-5 0-12-1-14-5Z",
    eyes: [[26, 40, 3.5, 8], [34.5, 40, 3.5, 8]],
  },
  sprout: { path: "M13 49C3 36 12 20 29 21c3-1 4-7 9-12 7-6 18-1 17 7-1 7-8 10-12 11 8 9 8 22 0 27-8 5-24 4-30-5Z", eyes: [[25,38,3.5,8],[35,38,3.5,8]] },
  branch: { path: "M22 49V34C9 31 3 23 6 16c3-8 13-8 18-1l8 10 8-10c5-7 15-7 18 1 3 7-3 15-16 18v15c0 9-20 9-20 0Z", eyes: [[26,38,3.5,8],[36,38,3.5,8]] },
  node: { path: "M17 39C3 36 4 19 14 11c9-7 19-4 20 4 1 4-1 8-4 10 13-8 28-2 29 11 2 15-10 22-25 21S11 50 17 39Z", eyes: [[29,38,3.5,8],[39,38,3.5,8]] },
  spore: { path: "M9 44c0-12 2-28 10-34 9-7 17 1 20 12 3 8 16 10 17 22 1 13-11 15-24 15S8 57 9 44Z", eyes: [[26,38,3.5,8],[36,38,3.5,8]] },
  colony: { path: "M5 40C4 23 17 13 29 19c4 2 6 6 8 8 11-8 24-1 24 12 1 14-10 18-27 18S6 54 5 40Z", eyes: [[24,36,3.5,8],[34,36,3.5,8]] },
  hypha: { path: "M9 45C4 33 5 12 16 9c12-4 17 7 12 17-3 7 0 9 8 6 10-4 22 1 23 12 1 13-13 14-26 13S12 56 9 45Z", eyes: [[32,39,3.5,8],[42,39,3.5,8]] },
  nexus: { path: "M23 23c0-10 3-17 12-17 12 0 9 13 10 19 11-1 17 5 15 14-2 10-14 8-20 8-2 10-10 15-17 10-6-4-4-12-5-17C6 42 1 34 6 27c4-7 12-4 17-4Z", eyes: [[26,27,3.5,8],[36,27,3.5,8]] },
  bridge: { path: "M4 43C7 24 17 10 32 10s25 14 28 33c2 10-4 14-12 13-7 0-8-5-8-12-1-7-15-7-16 0 0 7-1 12-8 12-8 1-14-3-12-13Z", eyes: [[26,23,3.5,8],[36,23,3.5,8]] },
  loop: { path: "M48 11C27 0 7 13 6 33 5 54 22 64 44 56c11-4 11-17 2-19-7-2-15 7-18-1-3-7 7-10 15-9 11 1 15-11 5-16Z", eyes: [[14,28,3.5,8],[24,28,3.5,8]] },
  crest: { path: "M7 44V31c0-11 12-13 17-4V13c0-12 17-12 17 0v14c5-9 17-7 17 4v13c0 12-10 14-26 14S7 56 7 44Z", eyes: [[26,36,3.5,8],[36,36,3.5,8]] },
  weave: { path: "M9 12c7-7 15-2 23 7 8-9 16-14 23-7 8 8 1 15-8 21 9 6 14 14 6 21-7 7-14 1-21-7-7 8-14 14-21 7-8-7-3-15 6-21C8 27 1 20 9 12Z", eyes: [[26,28,3.5,8],[36,28,3.5,8]] },
};

export function micoAvatarArt(shapeIndex: number, color: string) {
  const shape = micoAvatarDisplayShape(shapeIndex);
  if (!shape) return undefined;
  const fill = resolvePersonaColorDef(shape.id, color).hex;
  const white = "#FFFFFF";
  const eyeColor =
    contrastRatio(fill, white) > contrastRatio(fill, MICO_AVATAR_EYE_COLOR)
      ? white
      : MICO_AVATAR_EYE_COLOR;
  return { ...art[shape.id], color: fill, eyeColor };
}
