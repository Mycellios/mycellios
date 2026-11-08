import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_VALUE_MAX_LENGTH,
  BotAvatarValueSchema,
  MICO_AVATAR_EYE_COUNT,
  MICO_AVATAR_PALETTES,
  MICO_AVATAR_SHAPES,
  isBotAvatarValue,
  micoAvatarDetails,
  micoAvatarValue,
  parseBotAvatarValue,
  UpdateBotInput,
  withMicoAvatarPalette,
  withMicoAvatarShape,
} from "./index.js";

describe("bot avatar values", () => {
  it("parses hex, encoded shapes, and data images", () => {
    expect(parseBotAvatarValue("#8B5CF6")).toEqual({ kind: "color", color: "#8B5CF6" });
    expect(parseBotAvatarValue("#8B5CF6::shape_3")).toEqual({
      kind: "shape",
      color: "#8B5CF6",
      shapeIndex: 3,
    });
    expect(parseBotAvatarValue("data:image/png;base64,abc")).toEqual({
      kind: "image",
      imageUrl: "data:image/png;base64,abc",
    });
  });

  it("does not treat remote URLs as images", () => {
    expect(parseBotAvatarValue("https://evil.example/track.png")).toEqual({
      kind: "other",
      raw: "https://evil.example/track.png",
    });
    expect(isBotAvatarValue("https://evil.example/track.png")).toBe(false);
  });

  it("round-trips the branded shape and lets each choice change independently", () => {
    const fox = withMicoAvatarShape("", 1001);
    expect(fox).toBe("#D47046::shape_2432");
    const mintFox = withMicoAvatarPalette(fox, "#67B793");
    expect(parseBotAvatarValue(mintFox)).toEqual({
      kind: "shape", color: "#67B793", shapeIndex: 1001,
    });
    expect(parseBotAvatarValue(withMicoAvatarShape(mintFox, 1011))).toEqual({
      kind: "shape", color: "#67B793", shapeIndex: 1011,
    });
    expect(micoAvatarDetails(mintFox)).toEqual({ eyes: 0, finish: "flat", original: false });
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: mintFox }).success).toBe(true);
    expect(parseBotAvatarValue("#8B5CF6::shape_9")).toMatchObject({ shapeIndex: 1 });
  });

  it("accepts persisted writes and rejects oversized or remote values", () => {
    expect(isBotAvatarValue("#3EC5A8")).toBe(true);
    expect(isBotAvatarValue("#8B5CF6::shape_0")).toBe(true);
    expect(isBotAvatarValue("data:image/webp;base64,aGVsbG8=")).toBe(true);
    expect(isBotAvatarValue("#8B5CF6::shape_3junk")).toBe(false);
    expect(
      isBotAvatarValue(`data:image/png;base64,${"A".repeat(BOT_AVATAR_VALUE_MAX_LENGTH)}`),
    ).toBe(false);
    expect(BotAvatarValueSchema.safeParse("#fff").success).toBe(true);
    expect(BotAvatarValueSchema.safeParse("not-a-color").success).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: "#8B5CF6::shape_2" }).success).toBe(
      true,
    );
    expect(
      UpdateBotInput.safeParse({ botId: "bot-1", color: "https://evil.example/x.png" }).success,
    ).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", color: "gray" }).success).toBe(false);
    expect(UpdateBotInput.safeParse({ botId: "bot-1", name: "Atlas" }).success).toBe(true);
  });

  it("round-trips every look through the existing update contract", () => {
    const values = new Set<string>();
    for (const { index } of MICO_AVATAR_SHAPES) {
      for (const { color } of MICO_AVATAR_PALETTES) {
        for (let eyes = 0; eyes < MICO_AVATAR_EYE_COUNT; eyes++) {
          for (const finish of index < 1012 ? (["flat", "plush"] as const) : (["flat"] as const)) {
            const value = micoAvatarValue(index, color, { eyes, finish, original: false });
            const saved = UpdateBotInput.parse({ botId: "bot-1", color: value }).color!;
            values.add(saved);
            expect(parseBotAvatarValue(saved)).toEqual({ kind: "shape", color, shapeIndex: index });
            expect(micoAvatarDetails(saved)).toEqual({ eyes, finish, original: false });
          }
        }
      }
    }
    expect(values.size).toBe(MICO_AVATAR_PALETTES.length * MICO_AVATAR_EYE_COUNT * (12 * 2 + 3));
  });

  it("preserves custom eyes and finish with original colors", () => {
    const original = micoAvatarValue(1011, "#8650DF", { eyes: 15, finish: "flat", original: true });
    expect(parseBotAvatarValue(original)).toMatchObject({ shapeIndex: 1011 });
    expect(micoAvatarDetails(original)).toEqual({ eyes: 15, finish: "flat", original: true });
    expect(micoAvatarDetails("#8650DF::shape_1011")).toEqual({ eyes: 0, finish: "flat", original: true });
    expect(micoAvatarDetails("#8650DF::shape_2401")).toEqual({ eyes: 0, finish: "plush", original: true });
    expect(parseBotAvatarValue("#8650DF::shape_2783")).toMatchObject({ shapeIndex: 1011 });
    const otter = micoAvatarValue(1014, "#A67A51", { eyes: 15, finish: "flat", original: true });
    expect(parseBotAvatarValue(otter)).toMatchObject({ shapeIndex: 1014 });
    expect(micoAvatarDetails(otter)).toEqual({ eyes: 15, finish: "flat", original: true });
  });
});
