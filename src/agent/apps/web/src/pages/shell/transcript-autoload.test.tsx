// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import type { ThreadMessage } from "@mycellios/contracts";
import { foldPeerReplies } from "@mycellios/core";
import { act, createRef, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t, i18n: { locale: "en" } }), Trans: ({ children }: { children: ReactNode }) => children };
});
import { Transcript } from "./transcript";

const noop = () => {};
const resolved = async () => {};
const message = (seq: number): ThreadMessage => ({
  id: `m${seq}`, threadId: "thread-1", seq, role: seq % 2 ? "user" : "bot", botId: "bot-1",
  blocks: [{ kind: "text", text: `Message ${seq}` }], createdAt: "2026-11-22T10:00:00.000Z",
} as ThreadMessage);

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
  i18n.load("en", {}); i18n.activate("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  window.matchMedia ??= (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as never;
  Element.prototype.scrollIntoView ??= () => undefined;
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function renderTranscript(props: Partial<ComponentProps<typeof Transcript>>) {
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const scrollRef = createRef<HTMLDivElement>();
  const all: ComponentProps<typeof Transcript> = {
    scrollRef, scrollRequest: null, onScrollRequestHandled: noop, artifactTarget: { botId: "bot-1" },
    transcript: foldPeerReplies([message(5), message(6)], { includePeerReceipts: true }), showToolActivity: false,
    olderCursor: 5, unreadAfterSeq: null, loadingOlder: false, answerableAskIds: new Set(), dismissableAskIds: new Set(),
    running: false, workingBots: [], onLoadOlder: noop, onShowBot: noop, onAnswer: resolved, onReply: noop, onMarkUnread: noop,
    onQuote: noop, onReact: resolved, onJumpToMessage: noop, onOpenPeerMessages: noop, peerBot: () => undefined,
    onRefresh: resolved, onBotChanged: resolved, onAddRoutine: noop, voiceReady: false, speakingMessageId: null,
    onSpeak: noop, onOpenComputer: noop, ...props,
  } as ComponentProps<typeof Transcript>;
  act(() => root!.render(<Transcript {...all} />));
  const scroller = host.querySelector<HTMLDivElement>('[data-testid="transcript"]')!;
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2_000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
  const rerender = async (next: Partial<ComponentProps<typeof Transcript>>) => {
    Object.assign(all, next);
    await act(async () => root!.render(<Transcript {...all} />));
  };
  return { host, scroller, rerender };
}

function scrollTo(scroller: HTMLDivElement, top: number) {
  act(() => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

describe("conversation transcript", () => {
  it("loads older messages by itself when scrolled near the top", async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    const { scroller } = renderTranscript({ onLoadOlder });
    scrollTo(scroller, 1_200);
    expect(onLoadOlder).not.toHaveBeenCalled();
    scrollTo(scroller, 100);
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it("stops loading by itself after a failure until the button is used", async () => {
    const onLoadOlder = vi.fn(async () => { throw new Error("offline"); });
    const { host, scroller } = renderTranscript({ onLoadOlder });
    scrollTo(scroller, 1_200);
    scrollTo(scroller, 50);
    await act(async () => { await Promise.resolve(); });
    scrollTo(scroller, 900);
    scrollTo(scroller, 40);
    expect(onLoadOlder).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Load earlier messages"]')!.click());
    expect(onLoadOlder).toHaveBeenCalledTimes(2);
  });

  it("keeps reading older pages while a short transcript cannot scroll, four at most", async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    const { scroller, rerender } = renderTranscript({ onLoadOlder });
    expect(onLoadOlder).not.toHaveBeenCalled();
    // Folded routine runs fill less than the window: nothing can scroll.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 400 });
    for (let cursor = 4; cursor >= -2; cursor--) await rerender({ olderCursor: cursor });
    expect(onLoadOlder).toHaveBeenCalledTimes(4);
  });

  it("stops filling once the transcript can scroll", async () => {
    const onLoadOlder = vi.fn(async () => undefined);
    const { scroller, rerender } = renderTranscript({ onLoadOlder });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 400 });
    await rerender({ olderCursor: 4 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 3_000 });
    await rerender({ olderCursor: 3 });
    expect(onLoadOlder).toHaveBeenCalledOnce();
  });

  it("never loads when nothing older exists", () => {
    const onLoadOlder = vi.fn();
    const { scroller } = renderTranscript({ onLoadOlder, olderCursor: null });
    scrollTo(scroller, 1_200);
    scrollTo(scroller, 0);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("shows a banner above the messages and a notice after them", () => {
    const { host } = renderTranscript({ banner: <p data-testid="banner">Opened by Ada</p>, footer: <p data-testid="footer">Failed</p> });
    const stack = host.querySelector('[data-testid="transcript"] > div')!;
    const banner = stack.querySelector('[data-testid="banner"]')!;
    const footer = stack.querySelector('[data-testid="footer"]')!;
    expect(banner.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stack.lastElementChild).toBe(footer);
  });
});
