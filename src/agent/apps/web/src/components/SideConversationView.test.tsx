// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));
vi.mock("@lingui/core/macro", () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }));
import { SideConversationView } from "./SideConversationView";
import { composerDraftStorageKey } from "../lib/composer-draft";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The person is looking at this window, as the read needs.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

const snapshot = (threadId: string, cursor: number) => ({
  threadId, cursor, olderCursor: null, botId: "mico", run: null,
  messages: [
    { id: "u1", threadId, seq: 0, role: "user", createdAt: "2026-11-22T10:00:00.000Z", blocks: [{ kind: "text", text: "Compare offers" }] },
    { id: "b1", threadId, seq: 1, role: "bot", createdAt: "2026-11-22T10:01:00.000Z", blocks: [{ kind: "text", text: "Two offers found" }] },
  ],
});

function render(threadId = "side") {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const head = vi.fn().mockResolvedValue({ threadId, cursor: 1 });
  const get = vi.fn().mockResolvedValue(snapshot(threadId, 1));
  const markRead = vi.fn().mockResolvedValue({ ok: true, unreadAfterSeq: null });
  const send = vi.fn().mockResolvedValue({ taskId: "t", runId: "r", seq: 2 });
  const answer = vi.fn();
  const client = { threads: { head, get, markRead, send, answer } } as never;
  const handlers = { onOpenInChat: vi.fn(), onClose: vi.fn(), onRead: vi.fn() };
  const draw = () => act(() => root.render(<SideConversationView botId="mico" threadId={threadId} title="Energy offers" micoName="Mico"
    client={client} {...handlers} />));
  return { host, head, get, markRead, send, handlers, draw };
}

describe("a conversation beside the main chat", () => {
  it("reads the conversation through its own client, then marks it read once", async () => {
    const view = render();
    await view.draw();
    await flush();
    expect(view.head).toHaveBeenCalledWith({ botId: "mico" });
    expect(view.get).toHaveBeenCalledTimes(1);
    expect(view.host.textContent).toContain("Two offers found");
    expect(view.markRead).toHaveBeenCalledTimes(1);
    expect(view.handlers.onRead).toHaveBeenCalledTimes(1);
  });

  it("waits for the window to be in front before it reads", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const view = render();
    await view.draw();
    await flush();
    expect(view.get).toHaveBeenCalledTimes(1);
    expect(view.markRead).not.toHaveBeenCalled();
  });

  it("refuses a snapshot of another conversation", async () => {
    const view = render();
    view.get.mockResolvedValueOnce(snapshot("someone-else", 1));
    await view.draw();
    await flush();
    expect(view.host.textContent).toContain("The server did not return this conversation.");
    expect(view.markRead).not.toHaveBeenCalled();
  });

  it("sends a message with a receipt and keeps the draft with the conversation", async () => {
    const view = render();
    await view.draw();
    await flush();
    const box = view.host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "Pick the cheaper one");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(localStorage.getItem(composerDraftStorageKey("bot:mico:task:side"))).toBe("Pick the cheaper one");
    await act(() => view.host.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await flush();
    expect(view.send).toHaveBeenCalledWith({ botId: "mico", text: "Pick the cheaper one", clientNonce: expect.any(String) });
    expect(localStorage.getItem(composerDraftStorageKey("bot:mico:task:side"))).toBeNull();
  });

  it("opens the conversation in the chat or closes it from its header", async () => {
    const view = render();
    await view.draw();
    await act(() => Array.from(view.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Open in the chat")!.click());
    expect(view.handlers.onOpenInChat).toHaveBeenCalled();
    await act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(view.handlers.onClose).toHaveBeenCalled();
  });
});
