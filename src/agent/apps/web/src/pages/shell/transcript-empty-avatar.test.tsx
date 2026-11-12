import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: ({ color, identity }: { color: string; identity: string }) => <span data-color={color} data-identity={identity} />,
}));
vi.mock("../../components/AuthMushroom", () => ({ AuthMushroom: () => <span data-brand-avatar /> }));
import { TranscriptEmptyAvatar } from "./transcript-empty-avatar";

describe("empty conversation avatar", () => {
  it("preserves the selected Mico identity and full saved appearance when switching chats", () => {
    for (const bot of [
      { id: "mico-green", color: "#216247::shape_1000" },
      { id: "mico-purple", color: "#8650DF::shape_1001" },
    ]) {
      const html = renderToStaticMarkup(<TranscriptEmptyAvatar bot={bot} />);
      expect(html).toContain(`data-color="${bot.color}"`);
      expect(html).toContain(`data-identity="${bot.id}"`);
      expect(html).not.toContain("data-brand-avatar");
    }
  });
  it("keeps the generic brand avatar for chats without one selected Mico", () => {
    expect(renderToStaticMarkup(<TranscriptEmptyAvatar />)).toContain("data-brand-avatar");
  });
});
