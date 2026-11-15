import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { marketingMicos, MicoAvatar } from "./AgentHeroDemo";

describe("current Agent artwork in the landing", () => {
  it.each(Object.entries(marketingMicos))("keeps %s aligned with Agent's atlas and face anchors", (name, art) => {
    const source = readFileSync("src/agent/packages/core/src/compact-mico-avatar.ts", "utf8");
    const native = source.match(new RegExp(`${art.index}: \\{ crop: \\[([^\\]]+)\\], face: \\[([^\\]]+)\\]`))!;
    expect(native).not.toBeNull();
    const [x, y, side] = native[1]!.split(",").map(Number);
    expect(art.crop).toBe(`${x} ${y} ${side} ${side}`);
    expect(art.face).toEqual(native[2]!.split(",").map(Number));
    const html = renderToStaticMarkup(<MicoAvatar name={name} />);
    expect(html).toContain('data-mico-avatar="plush"');
    expect(html).toContain(`data-mico-shape="${art.shape}"`);
    expect(html).toContain("micos-mycelium-eyeless.png");
    expect(html.match(/class="mico-eye"/g)).toHaveLength(2);
    expect(html).not.toContain("/assets/agent-demo/");
  });
  it("falls back to the current mushroom and keeps the greeting's animated face target", () => {
    const html = renderToStaticMarkup(<MicoAvatar name="unknown" />);
    expect(html).toContain('data-mico-shape="mushroom"');
    expect(html).toContain('class="mico-face"');
    expect(html).toContain('aria-hidden="true"');
  });
});
