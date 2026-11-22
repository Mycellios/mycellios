// @vitest-environment jsdom
import type { SideThreadRequest } from "@mycellios/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));
vi.mock("@lingui/core/macro", () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }));
import { answersInMainChat, MirroredRequests } from "./MirroredRequests";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

const at = "2026-11-22T10:00:00.000Z";
const approval: SideThreadRequest = {
  threadId: "deploy", title: "Deploy the site", runId: "run-1", messageId: "message-1", kind: "approval", createdAt: at,
  block: { kind: "ask", text: "Run the deploy script?", approvalEffectId: "effect-1", status: "pending",
    actions: [{ id: "allow", label: "Allow once" }, { id: "deny", label: "Deny" }] },
};
const takeover: SideThreadRequest = {
  threadId: "form", title: "Fill the form", runId: "run-2", messageId: null, kind: "takeover", block: null, createdAt: at,
};
const secret: SideThreadRequest = {
  threadId: "login", title: "Sign in", runId: "run-3", messageId: "message-3", kind: "secret", createdAt: at,
  block: { kind: "ask", text: "Paste the API key", input: "secret", status: "pending" },
};

function render(requests: SideThreadRequest[], enabled = true) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const list = vi.fn().mockResolvedValueOnce(requests).mockResolvedValue([]);
  const head = vi.fn().mockResolvedValue({ threadId: "deploy", cursor: 3 });
  const answer = vi.fn().mockResolvedValue({ ok: true });
  const bind = vi.fn(() => ({ threads: { head, answer } }) as never);
  const open = vi.fn();
  const rpc = { development: { requests: list } } as never;
  const draw = (on = enabled) => act(() => root.render(<MirroredRequests botId="mico" enabled={on} revision="1" rpc={rpc}
    bind={bind} onOpenConversation={open} />));
  return { host, list, head, answer, bind, open, draw };
}

describe("requests from conversations in the main chat", () => {
  it("reads nothing while no conversation waits", async () => {
    const view = render([approval], false);
    await view.draw();
    await flush();
    expect(view.list).not.toHaveBeenCalled();
    expect(view.host.textContent).toBe("");
  });

  it("answers an approval through that conversation's own client, read first, and then lets the card go", async () => {
    const view = render([approval, takeover, secret]);
    await view.draw();
    await flush();
    const cards = Array.from(view.host.querySelectorAll("[data-mirrored-request]")).map(card => card.getAttribute("data-request-kind"));
    expect(cards).toEqual(["approval", "takeover", "secret"]);
    expect(view.host.textContent).toContain("Approval needed in Deploy the site");
    const allow = Array.from(view.host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Allow once")!;
    await act(() => allow.click());
    await flush();
    expect(view.bind).toHaveBeenCalledWith("deploy");
    expect(view.head.mock.invocationCallOrder[0]!).toBeLessThan(view.answer.mock.invocationCallOrder[0]!);
    expect(view.answer).toHaveBeenCalledWith({ botId: "mico", runId: "run-1", messageId: "message-1", answer: "allow" });
    // The list is read again; an answer given anywhere removes the card everywhere.
    expect(view.list).toHaveBeenCalledTimes(2);
    expect(view.host.querySelector('[data-mirrored-request="deploy"]')).toBeNull();
  });

  it("sends credentials and takeovers to their conversation instead of answering here", async () => {
    expect(answersInMainChat(secret)).toBe(false);
    expect(answersInMainChat(takeover)).toBe(false);
    expect(answersInMainChat(approval)).toBe(true);
    const view = render([takeover, secret]);
    await view.draw();
    await flush();
    expect(view.host.querySelector('input[type="password"]')).toBeNull();
    expect(view.host.textContent).toContain("Open the conversation to take over the computer.");
    const openButtons = Array.from(view.host.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.textContent === "Open conversation");
    await act(() => openButtons[1]!.click());
    expect(view.open).toHaveBeenCalledWith("login");
  });
});
