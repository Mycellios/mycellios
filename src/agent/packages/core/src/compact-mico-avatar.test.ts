import { describe, expect, it } from "vitest";
import { MICO_COMPACT_AVATAR_INDEXES, micoAvatarDetails, micoAvatarValue, withMicoAvatarPalette } from "@rakazo/contracts";
import { compactMicoArt, compactMicoEyes, compactMicoTint, COMPACT_EYE_HEIGHT, COMPACT_EYE_PAD, COMPACT_EYE_WIDTH } from "./compact-mico-avatar.js";
import { padPieces } from "./bloub-eye-slices.js";

describe("compact velvet Micos", () => {
  it("uses the approved bodies by default without changing saved color or explicit finishes", () => {
    for (const index of MICO_COMPACT_AVATAR_INDEXES) {
      const art = compactMicoArt(index)!;
      expect(art).toBeDefined();
      const value = micoAvatarValue(index, "#3D4C9E");
      expect(micoAvatarDetails(value)).toEqual({ eyes: 0, finish: "plush", original: false });
      expect(micoAvatarDetails(micoAvatarValue(index, "#3D4C9E", { eyes: 7, finish: "flat", original: true })))
        .toEqual({ eyes: 7, finish: "flat", original: true });
      const tint = compactMicoTint("#67B793", art);
      expect(tint.tables[0]?.split(" ")[2]).toBe(String(0x67 / 255));
      expect(micoAvatarDetails(withMicoAvatarPalette(value, "#67B793"))).toMatchObject({ finish: "plush", original: false });
    }
    expect(compactMicoArt(1014)).toBeUndefined();
    expect(compactMicoArt(undefined)).toBeUndefined();
  });

  it("retains the upstream neutral capsule proportions and original pad layout", () => {
    expect(COMPACT_EYE_WIDTH / COMPACT_EYE_HEIGHT).toBeCloseTo(0.186 / 0.412, 12);
    const pieces = padPieces(COMPACT_EYE_PAD, COMPACT_EYE_WIDTH, COMPACT_EYE_HEIGHT);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.every((p) => p.w > 0 && p.h > 0)).toBe(true);
    for (const index of MICO_COMPACT_AVATAR_INDEXES) {
      const eyes = compactMicoEyes(compactMicoArt(index)!);
      expect(eyes).toHaveLength(2);
      expect(eyes[0]!.x).toBeLessThan(eyes[1]!.x);
      expect(eyes.every((eye) => eye.x > 0 && eye.x < 64 && eye.y > 0 && eye.y < 64)).toBe(true);
    }
  });

  it("supports all channels and short hex colors while retaining the alpha row", () => {
    for (const index of MICO_COMPACT_AVATAR_INDEXES) {
      const art = compactMicoArt(index)!;
      expect(compactMicoTint("#abc", art)).toEqual(compactMicoTint("#aabbcc", art));
      const tint = compactMicoTint("#FF0066", art);
      expect(tint.matrix.split(" ").slice(-5)).toEqual(["0", "0", "0", "1", "0"]);
      expect(tint.tables.map((v) => v.split(" ")[2])).toEqual(["1", "0", String(0x66 / 255)]);
    }
  });
});
