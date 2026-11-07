import { MICO_AVATAR_PALETTES, MICO_AVATAR_SHAPES, micoAvatarValue } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  BotShapePreview,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

describe("BotAvatar", () => {
  it("draws all twelve branded shapes with their own silhouettes and palette accents", () => {
    const silhouettes = MICO_AVATAR_SHAPES.map(({ index }, slot) => {
      const palette = MICO_AVATAR_PALETTES[slot]!;
      const value = micoAvatarValue(index, palette.color, { eyes: 0, finish: "flat", original: true });
      const html = renderToString(<BotAvatar color={value} size={26} />);
      expect(html).toContain('data-mico-avatar="flat"');
      expect(html).toContain('viewBox="0 0 64 64"');
      expect(html).toContain(`fill="${palette.color}"`);
      expect(html).toContain(`fill="${palette.accent}"`);
      return html.match(/<path d="([^"]+)"/)?.[1];
    });
    expect(new Set(silhouettes).size).toBe(12);
  });

  it("uses the twelve velvet crops by default", () => {
    const crops = MICO_AVATAR_SHAPES.map(({ index }) => {
      const html = renderToString(<BotAvatar color={micoAvatarValue(index, "#8650DF")} />);
      expect(html).toContain('data-mico-avatar="plush"');
      expect(html).toContain("<image");
      expect(html).not.toContain("<feColorMatrix");
      return html.match(/<svg viewBox="([^"]+)"/)?.[1];
    });
    expect(new Set(crops).size).toBe(12);
  });

  it("renders distinct SVG filter and gradient IDs for concurrent working avatars", () => {
    const html = renderToString(
      <div>
        <BotAvatar color={micoAvatarValue(1000, "#8B5CF6", { eyes: 0, finish: "plush", original: false })} status="running" />
        <BotAvatar color={micoAvatarValue(1001, "#10B981", { eyes: 0, finish: "plush", original: false })} status="running" />
      </div>,
    );

    const gradMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(gradMatches).toHaveLength(4);
    expect(new Set(gradMatches).size).toBe(4);
    for (const id of gradMatches) {
      expect(id).toBeTruthy();
      expect(html).toContain(`url(#${id})`);
    }
  });

  // Button sizes any SVG without a size class, which beats width/height attributes but not inline styles.
  it("sizes the shape with an inline style so icon sizing in a button cannot shrink it", () => {
    const html = renderToString(<BotAvatar color="#8B5CF6::shape_0" size={26} />);
    const shape = html.match(/<svg[^>]*class="overflow-hidden"[^>]*>/)?.[0];
    expect(shape).toMatch(/style="[^"]*width:26px;height:26px/);
  });

  it.each([...ACTIVE_RUN_STATUSES])("marks active run status %s as working", (status) => {
    const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
    expect(html).toContain("<svg");
    expect(html).toContain('data-working="true"');
  });

  it("keeps working attribute false when idle", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
  });

  it("renders distinct shapes for distinct bot identities", () => {
    const maya = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    const github = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="github" />);
    expect(maya).not.toEqual(github);
  });

  it("parses shape indexes from encoded color values", () => {
    const parsed = parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`);
    expect(parsed.color).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(parsed.shapeIndex).toBe(3);
    expect(parsed.isImage).toBe(false);
  });

  it("normalizes malformed shape suffixes to shape 0", () => {
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_-1`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3junk`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_`).shapeIndex).toBe(0);
  });

  it("resolves explicit colors and shapes", () => {
    expect(resolvePersonaColorDef("bot", "#10B981").hex.toLowerCase()).toBe("#10b981");
    expect(resolvePersonaColorDef("bot", "#fff").hex).toBe("#fff");
    expect(BOT_AVATAR_COLORS.length).toBeGreaterThan(0);
  });

  it("falls back to the identity palette for invalid custom hex", () => {
    expect(resolvePersonaColorDef("bot", "#zzzzzz")).toEqual(resolvePersonaColorDef("bot"));
    expect(resolvePersonaColorDef("bot", "#ggg")).toEqual(resolvePersonaColorDef("bot"));
  });

  it("renders uploaded images without the geometric svg", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} />,
    );
    expect(html).toContain("<img");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("bot-character-eyes");
  });

  it("keeps a working photo ring outside the clipped image and uses the status token", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('class="rakazo-bot-avatar relative shrink-0 select-none"');
    expect(html).toContain("rakazo-bot-avatar-picture");
    expect(html).toContain("rakazo-bot-avatar-ring-working");
    expect(html).toContain("stroke-status-working");
    expect(html).toContain('data-working="true"');
    expect(html.indexOf("rakazo-bot-avatar-picture")).toBeLessThan(
      html.indexOf("rakazo-bot-avatar-ring"),
    );
  });

  it("keeps idle photo avatars ring-free", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="idle" />,
    );
    expect(html).toContain("rakazo-bot-avatar-picture");
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("rakazo-bot-avatar-ring");
  });

  it("does not treat arbitrary http(s) color values as remote images", () => {
    const parsed = parseBotAvatar("https://evil.example/track.png");
    expect(parsed.isImage).toBe(false);
    expect(parsed.imageUrl).toBeUndefined();
    const html = renderToString(
      <BotAvatar color="https://evil.example/track.png" identity="maya" size={32} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });

  it("marks only the Mico eyes for animation while working", () => {
    const html = renderToString(
      <BotAvatar color="#8B5CF6::shape_0" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('data-mico-avatar="plush"');
    expect(html.match(/class="rakazo-mico-eye"/g)).toHaveLength(2);
    expect(html).not.toContain("animate-pulse");
  });

  it("restores a plain color that renders an automatic mascot", () => {
    expect(defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)).toBe(
      DEFAULT_BOT_AVATAR_COLOR,
    );
    expect(defaultBotAvatarValue("#EAB308::shape_1")).toBe("#EAB308");
    expect(defaultBotAvatarValue("#abc::shape_2")).toBe("#abc");
    expect(defaultBotAvatarValue("#fff")).toBe("#fff");
    expect(defaultBotAvatarValue("data:image/png;base64,abc")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("#zzzzzz::shape_1")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("")).toBe(DEFAULT_BOT_AVATAR_COLOR);

    const restored = renderToString(
      <BotAvatar
        color={defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)}
        identity="maya"
      />,
    );
    const shaped = renderToString(
      <BotAvatar color={`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`} identity="maya" />,
    );
    expect(restored).toContain('data-mico-avatar="plush"');
    expect(shaped).toContain('data-mico-avatar="plush"');
    expect(restored.match(/<svg viewBox="([^"]+)"/)?.[1]).not.toBe(shaped.match(/<svg viewBox="([^"]+)"/)?.[1]);
  });

  it("exposes shape picker name and pressed state", () => {
    const html = renderToString(
      <BotShapePreview shapeIndex={0} color="#8B5CF6" selected onClick={() => undefined} />,
    );
    expect(html).toContain('aria-label="hex"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("focus-visible:ring-2");
  });

  it("previews an automatic mascot when no studio shape is given", () => {
    const html = renderToString(
      <BotShapePreview identity="maya" label="Shape 1" color="#8B5CF6" selected={false} />,
    );
    expect(html).toContain('aria-label="Shape 1"');
    expect(html).toContain('data-mico-avatar="plush"');
  });

  it("draws plain-colour bots with the current mascot collection", () => {
    const html = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    expect(html).toContain('data-mico-avatar="plush"');
    expect(html).not.toContain("rakazo-bot-avatar-visor");
  });

  it("keeps uploaded images", () => {
    const html = renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" />);
    expect(html).toContain("<img");
    expect(html).not.toContain("rakazo-organic-avatar");
  });

  it("draws the matching current mascot for an encoded legacy shape", () => {
    const html = renderToString(
      <BotAvatar color={`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`} identity="maya" />,
    );
    const modern = renderToString(
      <BotAvatar color={micoAvatarValue(MICO_AVATAR_SHAPES[3].index, DEFAULT_BOT_AVATAR_COLOR)} identity="maya" />,
    );
    expect(html.match(/<svg viewBox="([^"]+)"/)?.[1]).toBe(modern.match(/<svg viewBox="([^"]+)"/)?.[1]);
    expect(html).toContain('data-mico-avatar="plush"');
  });

  it("uses the original artwork when the custom color is invalid", () => {
    const html = renderToString(<BotAvatar color="#zzzzzz" identity="maya" />);
    expect(html).toContain("<image");
    expect(html).not.toContain("<feComponentTransfer");
    expect(html).not.toContain("#zzzzzz");
  });
});
