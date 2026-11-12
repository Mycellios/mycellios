// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Button } from "@rakazo/ui-web";
import { ChatHeaderTools, ChatToolsPanel } from "./chat-tools-panel";
import { writeRightPanelState, readRightPanelState } from "../../lib/right-panel-state";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => vi.unstubAllGlobals());
async function rendered(check: (host: HTMLDivElement, actions: Record<string, ReturnType<typeof vi.fn>>) => Promise<void>) {
  const actions = { onBrowser: vi.fn(), onFiles: vi.fn(), onSettings: vi.fn(), onVoice: vi.fn(), invite: vi.fn() };
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><ChatHeaderTools open={open} onToggle={() => setOpen(value => !value)} />
      {open ? <ChatToolsPanel {...actions} onClose={() => setOpen(false)}>{() => <Button onClick={actions.invite}>Invite friends</Button>}</ChatToolsPanel> : null}</>;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<Harness />)); await check(host, actions); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
it("opens a full-height side panel instead of a popup and toggles it closed", async () => {
  await rendered(async host => {
    expect(host.querySelectorAll("button")).toHaveLength(1);
    const trigger = host.querySelector("button")!;
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#chat-tools-sidebar")?.classList.contains("h-full")).toBe(true);
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    await act(async () => trigger.click());
    expect(host.querySelector("#chat-tools-sidebar")).toBeNull();
  });
});
it.each([["Open browser", "onBrowser"], ["Open library", "onFiles"], ["Agent settings", "onSettings"], ["Open voice", "onVoice"], ["Invite friends", "invite"]])("keeps %s functional in the panel", async (label, action) => {
  await rendered(async (host, actions) => {
    await act(async () => host.querySelector("button")!.click());
    const button = Array.from(host.querySelectorAll("button")).find(button => button.textContent === label)!;
    await act(async () => button.click());
    expect(actions[action]).toHaveBeenCalledOnce();
  });
});
it("closes using its explicit close button", async () => {
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close tools"]')!.click());
    expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  });
});
it("does not overwrite a remembered settings panel with the transient tools launcher", () => {
  writeRightPanelState("tools-test", "settings");
  writeRightPanelState("tools-test", "tools");
  expect(readRightPanelState("tools-test")).toEqual({ panel: "settings" });
  localStorage.removeItem("tools-test");
});
