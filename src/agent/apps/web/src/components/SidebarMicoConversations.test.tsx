// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));
vi.mock("@lingui/core/macro", () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }));
import { HoverConversations, SidebarMicoConversations } from "./SidebarMicoConversations";
import type { ConversationRow } from "../lib/thread-tabs";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });
const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const rows: ConversationRow[] = [
  { threadId: "asks", title: "Choose a supplier", state: "waiting", updatedAt: at(40) },
  ...["a", "b", "c", "d", "e"].map((id, index) => ({ threadId: id, title: `Topic ${id}`, state: "idle" as const, updatedAt: at(index + 1) })),
];
const listed = (host: ParentNode) => Array.from(host.querySelectorAll("[data-sidebar-conversation]")).map(row => row.getAttribute("data-sidebar-conversation"));

describe("a Mico's conversations in the sidebar", () => {
  it("lists the ones needing a look and three recent others, then Show N more and Show less", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const open = vi.fn(), toggle = vi.fn();
    await act(() => root.render(<SidebarMicoConversations rows={rows} all={false} onToggleAll={toggle} activeThreadId="b" onOpen={open} />));
    expect(listed(host)).toEqual(["asks", "a", "b", "c"]);
    expect(host.querySelector('[data-sidebar-conversation="b"]')?.getAttribute("aria-current")).toBe("page");
    const more = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Show 2 more")!;
    await act(() => more.click());
    expect(toggle).toHaveBeenCalled();
    await act(() => root.render(<SidebarMicoConversations rows={rows} all onToggleAll={toggle} onOpen={open} />));
    expect(listed(host)).toEqual(["asks", "a", "b", "c", "d", "e"]);
    expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Show less")).toBe(true);
    await act(() => host.querySelector<HTMLButtonElement>('[data-sidebar-conversation="asks"]')!.click());
    expect(open).toHaveBeenCalledWith("asks");
  });

  it("fills the hover card only with what is already loaded, else the roster's summary", () => {
    const withRows = renderToStaticMarkup(<HoverConversations rows={rows} onOpen={() => undefined} />);
    expect(withRows).toContain("Conversations: 6");
    expect(withRows).toContain("Choose a supplier");
    const summaryOnly = renderToStaticMarkup(<HoverConversations rows={[]} onOpen={() => undefined}
      summary={{ open: 4, unread: 1, waiting: 2, working: 0, revision: "r" }} />);
    expect(summaryOnly).toContain("Conversations: 4");
    expect(summaryOnly).toContain("Waiting for you: 2");
    expect(renderToStaticMarkup(<HoverConversations rows={[]} onOpen={() => undefined} />)).toBe("");
  });
});
