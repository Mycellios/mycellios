import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  MICO_MYCELIUM_SHAPES, MICO_AVATAR_PALETTES, micoAvatarDetails, micoAvatarValue,
  parseBotAvatarValue, withMicoAvatarPalette,
} from "@rakazo/contracts";
import { compactMicoArt, compactMicoEyes, compactMicoEyeColor, COMPACT_EYE_WIDTH, COMPACT_EYE_HEIGHT, currentMicoAvatarValue, liveliness, myceliumEyeFrame } from "@rakazo/core";
import { BotAvatar } from "./bot-avatar.js";

describe("mycelium avatars", () => {
  it("round-trips every new appearance independently without consuming historical slots", () => {
    for (const shape of MICO_MYCELIUM_SHAPES) for (let eyes = 0; eyes < 16; eyes++) {
      for (const finish of ["flat", "plush"] as const) for (const original of [true, false]) {
        const look = { eyes, finish, original };
        const value = micoAvatarValue(shape.index, "#3D4C9E", look);
        expect(parseBotAvatarValue(value)).toEqual({ kind: "shape", color: "#3D4C9E", shapeIndex: shape.index });
        expect(micoAvatarDetails(value)).toEqual(look);
      }
    }
    expect(parseBotAvatarValue("#A67A51::shape_2864")).toMatchObject({ shapeIndex: 1014 });
    expect(micoAvatarDetails("#A67A51::shape_2864")).toEqual({ eyes: 0, finish: "flat", original: false });
    expect(parseBotAvatarValue("#D47046::shape_2432")).toMatchObject({ shapeIndex: 1001 });
    expect(micoAvatarDetails("#D47046::shape_2432")).toEqual({ eyes: 0, finish: "flat", original: true });
  });
  it("renders all twelve approved bodies with separate original Bloub eyes and a saved color filter", () => {
    expect(MICO_MYCELIUM_SHAPES).toHaveLength(12);
    expect(MICO_AVATAR_PALETTES).toHaveLength(24);
    for (const shape of MICO_MYCELIUM_SHAPES) {
      const base = micoAvatarValue(shape.index, shape.originalColor, { eyes: 0, finish: "plush", original: true });
      const changed = withMicoAvatarPalette(base, "#C94A51");
      expect(micoAvatarDetails(changed)).toEqual({ eyes: 0, finish: "plush", original: false });
      const html = renderToString(<BotAvatar color={changed} size={36} identity={shape.id} />);
      expect(html).toContain(shape.index >= 1106 ? "micos-mycelium-growth-eyeless.png" : "micos-mycelium-eyeless.png");
      expect(html).toContain('data-mico-mycelium=""');
      expect(html).toContain('data-mico-eye-source="bloub-0.6.4"');
      expect(html).toContain('width:36px;height:36px');
      expect(html).toContain('data-mycelium-lid="0"');
      expect(html).toContain('data-mycelium-lid="1"');
      expect(html).toContain("<feComponentTransfer>");
    }
  });
  it("retains photos and explicit flat shapes; replaces historical animals at display time", () => {
    expect(renderToString(<BotAvatar color="data:image/png;base64,abc" />)).toContain("<img");
    expect(renderToString(<BotAvatar color={micoAvatarValue(1101, "#CD9A37", { eyes: 0, finish: "flat", original: false })} />)).toContain('data-mico-avatar="flat"');
    expect(renderToString(<BotAvatar color={micoAvatarValue(1001, "#D47046", { eyes: 0, finish: "plush", original: true })} />)).toContain("micos-mycelium-eyeless.png");
  });
  it("maps every historical animal to the new family without changing its saved color", () => {
    for (let index = 1001; index <= 1014; index++) {
      const old = micoAvatarValue(index, "#3D4C9E", { eyes: 7, finish: "flat", original: false });
      const shown = currentMicoAvatarValue(old, "existing-bot");
      expect(parseBotAvatarValue(shown)).toMatchObject({ kind: "shape", color: "#3D4C9E" });
      expect(micoAvatarDetails(shown)).toEqual({ eyes: 7, finish: "plush", original: false });
      const parsed = parseBotAvatarValue(shown);
      expect(parsed.kind === "shape" && MICO_MYCELIUM_SHAPES.some(s => s.index === parsed.shapeIndex)).toBe(true);
    }
  });
  it("keeps compact frontal eyes proportional and uses one felt ink on the shaded original faces", () => {
    for (const shape of MICO_MYCELIUM_SHAPES) {
      const art = compactMicoArt(shape.index)!;
      const eyes = compactMicoEyes(art);
      expect(eyes).toHaveLength(2);
      expect(eyes[0]!.y).toBe(eyes[1]!.y);
      expect(eyes[0]!.matrix).toBe(eyes[1]!.matrix);
      expect(eyes[0]!.matrix).toBe(`matrix(${eyes[0]!.scale} 0 0 ${eyes[0]!.scale} 0 0)`);
      expect(COMPACT_EYE_WIDTH * eyes[0]!.scale).toBeGreaterThanOrEqual(2.9);
      expect(COMPACT_EYE_HEIGHT * eyes[0]!.scale).toBeLessThanOrEqual(7.2);
      expect(compactMicoEyeColor(shape.originalColor, art, true)).toBe("#F4F0E4");
    }
    expect(compactMicoEyeColor("#3D4C9E", compactMicoArt(1102)!)).toBe("#F4F0E4");
    expect(compactMicoEyeColor("#52A5D8", compactMicoArt(1105)!)).toBe("#F4F0E4");
    expect(compactMicoEyeColor("#E5DFCA", compactMicoArt(1102)!)).toBe("#1D2B23");
  });
  it("keeps all visible body pixels away from every crop edge", async () => {
    const { default: sharp } = await import("sharp");
    const { fileURLToPath } = await import("node:url");
    const sheets = new Map();
    for (const collection of ["mycelium", "growth"]) {
      const filename = collection === "growth" ? "micos-mycelium-growth-eyeless.png" : "micos-mycelium-eyeless.png";
      sheets.set(collection, await sharp(fileURLToPath(new URL(`../../core/assets/${filename}`, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    }
    for (const shape of MICO_MYCELIUM_SHAPES) {
      const art = compactMicoArt(shape.index)!;
      const { data, info } = sheets.get(art.collection)!;
      const [x, y, side] = art.crop;
      const alpha = (px: number, py: number) => px < 0 || py < 0 || px >= info.width || py >= info.height ? 0 : data[(py * info.width + px) * 4 + 3]!;
      let edgeAlpha = 0;
      for (let inset = 0; inset < 12; inset++) {
        for (let px = Math.ceil(x); px < Math.floor(x + side); px++) {
          edgeAlpha = Math.max(edgeAlpha, alpha(px, Math.ceil(y) + inset), alpha(px, Math.floor(y + side) - 1 - inset));
        }
        for (let py = Math.ceil(y); py < Math.floor(y + side); py++) {
          edgeAlpha = Math.max(edgeAlpha, alpha(Math.ceil(x) + inset, py), alpha(Math.floor(x + side) - 1 - inset, py));
        }
      }
      expect(edgeAlpha, `${shape.id} must retain transparent padding`).toBeLessThanOrEqual(16);
    }
  });
  it("uses deterministic upstream blink timing and independent identity phases", () => {
    expect(liveliness(1.4).lid).toBeCloseTo(1);
    expect(liveliness(1.481).lid).toBeCloseTo(0, 4);
    expect(liveliness(1.581).lid).toBe(1);
    expect(myceliumEyeFrame(2, undefined, 1)).toEqual(myceliumEyeFrame(2, undefined, 1));
    expect(myceliumEyeFrame(2, undefined, 1)).not.toEqual(myceliumEyeFrame(2, undefined, 7));
    for (let t = 0; t < 900; t += 0.137) {
      const frame = myceliumEyeFrame(t, "running");
      expect(Number.isFinite(frame.x + frame.y + frame.roll + frame.lid)).toBe(true);
      expect(frame.lid).toBeGreaterThanOrEqual(0.06);
      expect(frame.lid).toBeLessThanOrEqual(1);
    }
  });
  it("distinguishes work, user waits and failure without changing identity", () => {
    expect(myceliumEyeFrame(3, "running").mood).toBe("working");
    expect(myceliumEyeFrame(3, "waiting_input").mood).toBe("waiting");
    expect(myceliumEyeFrame(3, "failed").mood).toBe("failed");
    expect(myceliumEyeFrame(3, "completed").mood).toBe("responded");
    expect(myceliumEyeFrame(3, "offline").lid).toBe(0.06);
  });
});
