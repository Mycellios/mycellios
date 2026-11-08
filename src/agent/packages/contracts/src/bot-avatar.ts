import * as z from "zod";

/** Matches the eight shipped mascot shapes in `@rakazo/core`. */
export const BOT_AVATAR_SHAPE_COUNT = 8;

// Keep the legacy shape slots and their modulo behavior for stored avatars.
export const MICO_AVATAR_SHAPES = [
  { id: "mushroom", index: 1000, originalColor: "#3F9F78" },
  { id: "fox", index: 1001, originalColor: "#D47046" },
  { id: "hedgehog", index: 1002, originalColor: "#BC8B32" },
  { id: "frog", index: 1003, originalColor: "#829B36" },
  { id: "moth", index: 1004, originalColor: "#5C84CC" },
  { id: "snail", index: 1005, originalColor: "#C55480" },
  { id: "owl", index: 1006, originalColor: "#CE5181" },
  { id: "turtle", index: 1007, originalColor: "#3F9F78" },
  { id: "axolotl", index: 1008, originalColor: "#B679BC" },
  { id: "crab", index: 1009, originalColor: "#EB6A61" },
  { id: "fish", index: 1010, originalColor: "#2E97AD" },
  { id: "octopus", index: 1011, originalColor: "#8F6BC7" },
  { id: "raven", index: 1012, originalColor: "#7D859A" },
  { id: "hare", index: 1013, originalColor: "#D77C77" },
  { id: "otter", index: 1014, originalColor: "#A67A51" },
] as const;

export const MICO_AVATAR_DEFAULT_SHAPES = MICO_AVATAR_SHAPES.filter(
  ({ id }) => id !== "mushroom" && id !== "owl" && id !== "crab",
);

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
  { id: "red", color: "#C94A51", accent: "#FFD0BB" },
  { id: "navy", color: "#3D4C9E", accent: "#C8D5FF" },
  { id: "sand", color: "#D6B98C", accent: "#FFF0CE" },
  { id: "wine", color: "#A8324E", accent: "#F6BDC9" },
  { id: "gray", color: "#97979E", accent: "#E6E2ED" },
] as const;

export const MICO_AVATAR_EYE_COUNT = 16;
const MICO_LOOK_START = 2000;
const MICO_ORIGINAL_LOOK_START = 2400;
const MICO_LOOK_STRIDE = MICO_AVATAR_EYE_COUNT * 2;
const MICO_LEGACY_LOOK_SHAPES = 12;
const MICO_LEGACY_LOOK_SLOTS = MICO_LEGACY_LOOK_SHAPES * MICO_LOOK_STRIDE;
const MICO_EXTRA_LOOK_START = 2800;

type MicoAvatarDetails = { eyes: number; finish: "flat" | "plush"; original: boolean };

function micoLookSlot(shapeIndex: number, start: number, length: number): number | undefined {
  const slot = shapeIndex - start;
  return Number.isInteger(slot) && slot >= 0 && slot < length ? slot : undefined;
}

// The original two ranges stay frozen. Additional shapes only support the flat finish.
function decodeMicoLook(shapeIndex: number): (MicoAvatarDetails & { ordinal: number }) | undefined {
  const tinted = micoLookSlot(shapeIndex, MICO_LOOK_START, MICO_LEGACY_LOOK_SLOTS);
  const legacy = tinted ?? micoLookSlot(shapeIndex, MICO_ORIGINAL_LOOK_START, MICO_LEGACY_LOOK_SLOTS);
  if (legacy !== undefined) {
    return {
      ordinal: Math.floor(legacy / MICO_LOOK_STRIDE),
      eyes: Math.floor((legacy % MICO_LOOK_STRIDE) / 2),
      finish: legacy % 2 ? "plush" : "flat",
      original: tinted === undefined,
    };
  }
  const extra = micoLookSlot(
    shapeIndex,
    MICO_EXTRA_LOOK_START,
    (MICO_AVATAR_SHAPES.length - MICO_LEGACY_LOOK_SHAPES) * MICO_LOOK_STRIDE,
  );
  if (extra === undefined) return undefined;
  return {
    ordinal: MICO_LEGACY_LOOK_SHAPES + Math.floor(extra / MICO_LOOK_STRIDE),
    eyes: extra % MICO_AVATAR_EYE_COUNT,
    finish: "flat",
    original: extra % MICO_LOOK_STRIDE >= MICO_AVATAR_EYE_COUNT,
  };
}

// Keep the existing wire format so older APIs can store the complete look.
export function micoAvatarDetails(value: string): MicoAvatarDetails {
  const shapeIndex = Number(/::shape_(\d+)$/.exec(value)?.[1]);
  const look = decodeMicoLook(shapeIndex);
  return look
    ? { eyes: look.eyes, finish: look.finish, original: look.original }
    : { eyes: 0, finish: "flat", original: true };
}

export function micoAvatarShape(shapeIndex: number | undefined) {
  return MICO_AVATAR_SHAPES.find((shape) => shape.index === shapeIndex);
}

export function micoAvatarPalette(color: string) {
  const hex = color.toUpperCase();
  return MICO_AVATAR_PALETTES.find((palette) => palette.color === hex);
}

export function micoAvatarValue(shapeIndex: number, color: string, details?: MicoAvatarDetails): string {
  const ordinal = MICO_AVATAR_SHAPES.findIndex((shape) => shape.index === shapeIndex);
  if (!details || ordinal < 0) return `${color}::shape_${shapeIndex}`;
  const eyes = Number.isInteger(details.eyes) && details.eyes >= 0 && details.eyes < MICO_AVATAR_EYE_COUNT
    ? details.eyes
    : 0;
  if (ordinal >= MICO_LEGACY_LOOK_SHAPES) {
    const slot = MICO_EXTRA_LOOK_START + (ordinal - MICO_LEGACY_LOOK_SHAPES) * MICO_LOOK_STRIDE +
      eyes + (details.original ? MICO_AVATAR_EYE_COUNT : 0);
    return `${color}::shape_${slot}`;
  }
  const start = details.original ? MICO_ORIGINAL_LOOK_START : MICO_LOOK_START;
  const slot = start + ordinal * MICO_LOOK_STRIDE + eyes * 2 + Number(details.finish === "plush");
  return `${color}::shape_${slot}`;
}

const primaryMicoShape = MICO_AVATAR_SHAPES[0];
export const MICO_PRIMARY_AVATAR = micoAvatarValue(primaryMicoShape.index, primaryMicoShape.originalColor);

/** Selecting a new shape keeps the palette, or starts with that shape's brand pairing. */
export function withMicoAvatarShape(value: string, shapeIndex: number): string {
  const current = parseBotAvatarValue(value);
  const color = current.kind === "shape" && micoAvatarShape(current.shapeIndex)
    ? current.color
    : undefined;
  const originalColor = micoAvatarShape(shapeIndex)?.originalColor ?? MICO_AVATAR_DEFAULT_SHAPES[0]!.originalColor;
  return micoAvatarValue(shapeIndex, color ?? originalColor, micoAvatarDetails(value));
}

export function withMicoAvatarPalette(value: string, color: string): string {
  const current = parseBotAvatarValue(value);
  const shape = current.kind === "shape" ? micoAvatarShape(current.shapeIndex) : undefined;
  return micoAvatarValue((shape ?? MICO_AVATAR_DEFAULT_SHAPES[0]!).index, color, {
    ...micoAvatarDetails(value),
    original: false,
  });
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
    const look = decodeMicoLook(parsedShape);
    const lookShape = look && MICO_AVATAR_SHAPES[look.ordinal];
    const shapeIndex = micoAvatarShape(parsedShape)?.index ?? lookShape?.index ??
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
