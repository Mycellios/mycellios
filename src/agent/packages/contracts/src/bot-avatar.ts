import * as z from "zod";

/** Matches the eight shipped mascot shapes in `@rakazo/core`. */
export const BOT_AVATAR_SHAPE_COUNT = 8;

// Keep the legacy shape slots and their modulo behavior for stored avatars.
export const MICO_AVATAR_SHAPES = [
  { id: "mushroom", index: 1000 },
  { id: "fox", index: 1001 },
  { id: "hedgehog", index: 1002 },
  { id: "frog", index: 1003 },
  { id: "moth", index: 1004 },
  { id: "snail", index: 1005 },
  { id: "owl", index: 1006 },
  { id: "turtle", index: 1007 },
  { id: "axolotl", index: 1008 },
  { id: "crab", index: 1009 },
  { id: "fish", index: 1010 },
  { id: "octopus", index: 1011 },
] as const;

export const MICO_AVATAR_PALETTES = [
  { id: "violet", color: "#8650DF", accent: "#FFD6AC" },
  { id: "tangerine", color: "#ED802C", accent: "#FFE3B7" },
  { id: "honey", color: "#CD9A37", accent: "#FFE5AD" },
  { id: "lime", color: "#90B848", accent: "#EBEFAD" },
  { id: "indigo", color: "#5266D9", accent: "#CBD6FF" },
  { id: "turquoise", color: "#28A99E", accent: "#B3EAD0" },
  { id: "raspberry", color: "#CE5181", accent: "#FFC5CF" },
  { id: "mint", color: "#67B793", accent: "#C9F0BD" },
  { id: "lavender", color: "#A887CC", accent: "#ECD8F9" },
  { id: "coral", color: "#EB6A61", accent: "#FFCEAC" },
  { id: "sky", color: "#52A5D8", accent: "#C7EAFF" },
  { id: "slate", color: "#60748C", accent: "#C6DCE7" },
] as const;

export function micoAvatarShape(shapeIndex: number | undefined) {
  return MICO_AVATAR_SHAPES.find((shape) => shape.index === shapeIndex);
}

export function micoAvatarPalette(color: string) {
  const hex = color.toUpperCase();
  return MICO_AVATAR_PALETTES.find((palette) => palette.color === hex);
}

export function micoAvatarValue(shapeIndex: number, color: string): string {
  return `${color}::shape_${shapeIndex}`;
}

/** Selecting a new shape keeps the palette, or starts with that shape's brand pairing. */
export function withMicoAvatarShape(value: string, shapeIndex: number): string {
  const current = parseBotAvatarValue(value);
  const palette = current.kind === "shape" && micoAvatarShape(current.shapeIndex)
    ? micoAvatarPalette(current.color)
    : undefined;
  const defaultPalette = MICO_AVATAR_PALETTES[shapeIndex - MICO_AVATAR_SHAPES[0].index];
  return micoAvatarValue(shapeIndex, (palette ?? defaultPalette ?? MICO_AVATAR_PALETTES[0]).color);
}

export function withMicoAvatarPalette(value: string, color: string): string {
  const current = parseBotAvatarValue(value);
  const shape = current.kind === "shape" ? micoAvatarShape(current.shapeIndex) : undefined;
  return micoAvatarValue((shape ?? MICO_AVATAR_SHAPES[0]).index, color);
}

/**
 * 256x256 webp data URLs from Avatar Studio stay well under this. Cap writes so
 * a pasted raw photo cannot bloat every bot list payload.
 */
export const BOT_AVATAR_VALUE_MAX_LENGTH = 200_000;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SHAPE_SUFFIX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})::shape_\d+$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ParsedBotAvatar =
  | { kind: "image"; imageUrl: string }
  | { kind: "shape"; color: string; shapeIndex: number }
  | { kind: "color"; color: string }
  | { kind: "other"; raw: string };

export function parseBotAvatarValue(raw: string): ParsedBotAvatar {
  if (raw.startsWith("data:image/")) {
    return { kind: "image", imageUrl: raw };
  }
  if (raw.includes("::shape_")) {
    const parts = raw.split("::shape_");
    const color = parts[0] || "#F97316";
    const rawShape = parts[1] ?? "0";
    const parsedShape = /^\d+$/.test(rawShape) ? Number(rawShape) : 0;
    const shapeIndex = micoAvatarShape(parsedShape)?.index ??
      (Number.isSafeInteger(parsedShape) ? parsedShape % BOT_AVATAR_SHAPE_COUNT : 0);
    return { kind: "shape", color, shapeIndex };
  }
  if (HEX_COLOR.test(raw)) return { kind: "color", color: raw };
  return { kind: "other", raw };
}

/** True for values we persist on `bots.color` (hex, encoded shape, or data image). */
export function isBotAvatarValue(raw: string): boolean {
  if (!raw || raw.length > BOT_AVATAR_VALUE_MAX_LENGTH) return false;
  return HEX_COLOR.test(raw) || SHAPE_SUFFIX.test(raw) || DATA_IMAGE.test(raw);
}

export const BotAvatarValueSchema = z
  .string()
  .min(1)
  .max(BOT_AVATAR_VALUE_MAX_LENGTH)
  .refine(isBotAvatarValue, { message: "Invalid bot avatar" });
