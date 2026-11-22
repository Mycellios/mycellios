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
const message = (seq: number, role: "user" | "bot" = "bot"): ThreadMessage => ({
  id: `m${seq}`, threadId: "thread-1", seq, role, botId: "bot-1",
  blocks: [{ kind: "text", text: `Message ${seq}` }], createdAt: "2026-11-22T10:00:00.000Z",
} as ThreadMessage);

/** Lets the test say whether the New divider is on screen. */
let observed: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => {
  i18n.load("en", {}); i18n.activate("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  window.matchMedia ??= (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as never;
  observed = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observed.push(callback); }
    observe() {} disconnect() {} unobserve() {}
  });
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function renderTranscript(props: Partial<ComponentProps<typeof Transcript>>) {
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const all = {
    scrollRef: createRef<HTMLDivElement>(), scrollRequest: null, onScrollRequestHandled: noop, artifactTarget: { botId: "bot-1" },
    transcript: foldPeerReplies([message(0), message(1, "user"), message(2), message(3), message(4)], { includePeerReceipts: true }),
    showToolActivity: false, olderCursor: null, unreadAfterSeq: 1, loadingOlder: false, answerableAskIds: new Set<string>(),
    dismissableAskIds: new Set<string>(), running: false, workingBots: [], onLoadOlder: noop, onShowBot: noop, onAnswer: resolved,
    onReply: noop, onMarkUnread: noop, onQuote: noop, onReact: resolved, onJumpToMessage: noop, onOpenPeerMessages: noop,
    peerBot: () => undefined, onRefresh: resolved, onBotChanged: resolved, onAddRoutine: noop, voiceReady: false,
    speakingMessageId: null, onSpeak: noop, onOpenComputer: noop, ...props,
  } as ComponentProps<typeof Transcript>;
  act(() => root!.render(<Transcript {...all} />));
  return host;
}

describe("new messages in a long conversation", () => {
  it("says how many are new while the New divider is out of sight, with jump and Mark as read", () => {
    const onMarkRead = vi.fn();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const host = renderTranscript({ onMarkRead });
    expect(host.querySelector('[data-testid="unread-divider"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="new-messages-banner"]')).toBeNull();
    act(() => observed.at(-1)!([{ isIntersecting: false }]));
    const banner = host.querySelector('[data-testid="new-messages-banner"]')!;
    expect(banner.textContent).toContain("3 new messages");
    const buttons = Array.from(banner.querySelectorAll("button"));
    act(() => buttons.find(button => button.textContent === "Jump")!.click());
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    act(() => buttons.find(button => button.textContent === "Mark as read")!.click());
    expect(onMarkRead).toHaveBeenCalledOnce();
    act(() => observed.at(-1)!([{ isIntersecting: true }]));
    expect(host.querySelector('[data-testid="new-messages-banner"]')).toBeNull();
  });

  it("shows nothing without a divider", () => {
    const host = renderTranscript({ unreadAfterSeq: null });
    expect(observed).toHaveLength(0);
    expect(host.querySelector('[data-testid="new-messages-banner"]')).toBeNull();
  });
});
