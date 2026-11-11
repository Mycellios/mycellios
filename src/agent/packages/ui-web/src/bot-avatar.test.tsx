import { MICO_AVATAR_DEFAULT_SHAPES, MICO_AVATAR_SHAPES, micoAvatarValue } from "@rakazo/contracts";
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
  it("retains the explicitly selected flat silhouettes and capsule eyes", () => {
    const silhouettes = MICO_AVATAR_DEFAULT_SHAPES.map(({ index, originalColor }) => {
      const html = renderToString(<BotAvatar color={micoAvatarValue(index, originalColor, { eyes: 0, finish: "flat", original: true })} size={26} />);
      expect(html).toContain('data-mico-avatar="flat"');
      expect(html).toContain('viewBox="0 0 64 64"');
      expect(html).toContain(`fill="${originalColor}"`);
      expect(html).toContain('<rect class="rakazo-mico-eye"');
      expect(html).not.toMatch(/(?:<image|<linearGradient|drop-shadow)/);
      return html.match(/<path d="([^"]+)"/)?.[1];
    });
    expect(new Set(silhouettes).size).toBe(12);
  });

  it("keeps an explicitly selected velvet avatar and its original artwork colors", () => {
    const color = micoAvatarValue(1001, "#8650DF", { eyes: 0, finish: "plush", original: true });
    const html = renderToString(<BotAvatar color={color} />);
    expect(html).toContain('data-mico-avatar="plush"');
    expect(html).toContain("<image");
    expect(html).not.toContain("<feColorMatrix");
  });

  it.each([
    ["#3D4C9E", 0, "#FFFFFF"],
    ["#D6B98C", 0, "#1D2B23"],
    ["#3D4C9E", 15, "#FFFFFF"],
    ["#D6B98C", 15, "#1D2B23"],
  ] as const)("contrasts eyes with %s in style %d", (color, eyes, expected) => {
    const value = micoAvatarValue(1011, color, { eyes, finish: "flat", original: false });
    const html = renderToString(<BotAvatar color={value} />);
    expect(html).toContain(`class="rakazo-mico-gaze" fill="${expected}"`);
  });

  it("renders distinct SVG filter and gradient IDs for concurrent working avatars", () => {
    const html = renderToString(
      <div>
        <BotAvatar color={micoAvatarValue(1000, "#8B5CF6", { eyes: 0, finish: "plush", original: false })} status="running" />
        <BotAvatar color={micoAvatarValue(1001, "#10B981", { eyes: 0, finish: "plush", original: false })} status="running" />
      </div>,
    );

    const gradMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(gradMatches).toHaveLength(2);
    expect(new Set(gradMatches).size).toBe(2);
    for (const id of gradMatches) {
      expect(id).toBeTruthy();
      expect(html).toContain(`url(#${id})`);
    }
  });

  // Button sizes any SVG without a size class, which beats width/height attributes but not inline styles.
  it("sizes the shape with an inline style so icon sizing in a button cannot shrink it", () => {
    const html = renderToString(<BotAvatar color="#8B5CF6::shape_0" size={26} />);
    const shape = html.match(/<svg[^>]*data-mico-avatar="(?:flat|plush)"[^>]*>/)?.[0];
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
    expect(html).toContain('data-mico-compact=""');
    expect(html.match(/class="rakazo-compact-mico-eye"/g)).toHaveLength(2);
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
    expect(restored).toMatch(/data-mico-avatar="(?:flat|plush)"/);
    expect(shaped).toContain('data-mico-avatar="flat"');
    expect(restored.match(/data-mico-shape="([^"]+)"/)?.[1]).not.toBe(shaped.match(/data-mico-shape="([^"]+)"/)?.[1]);
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
    expect(html).toMatch(/data-mico-avatar="(?:flat|plush)"/);
  });

  it("draws plain-colour bots with the current mascot collection", () => {
    const html = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    expect(html).toMatch(/data-mico-avatar="(?:flat|plush)"/);
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
    expect(html.match(/data-mico-shape="([^"]+)"/)?.[1]).toBe(modern.match(/data-mico-shape="([^"]+)"/)?.[1]);
    expect(html).toContain('data-mico-avatar="flat"');
  });

  it("uses a safe fallback when the custom color is invalid", () => {
    const html = renderToString(<BotAvatar color="#zzzzzz" identity="maya" />);
    expect(html).toMatch(/data-mico-avatar="(?:flat|plush)"/);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("#zzzzzz");
  });

  it("draws separate original Bloub eye pads over the eyeless compact body", () => {
    const html = renderToString(<BotAvatar color={micoAvatarValue(1001, "#C94A51")} size={36} />);
    expect(html).toContain('data-mico-compact=""');
    expect(html).toContain('data-mico-eye-source="bloub-0.6.4"');
    expect(html).toContain("micos-compact-eyeless.webp");
    expect(html).toContain("bloub-eye-y.webp");
    expect(html).not.toContain("<linearGradient");
    expect(html).toContain("<feComponentTransfer");
  });
});
