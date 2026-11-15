// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  userId: "owner",
  list: vi.fn(),
  send: vi.fn(),
  sent: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../lib/auth", () => ({
  authClient: {
    useSession: () => ({ data: state.userId ? { user: { id: state.userId } } : null }),
  },
}));
vi.mock("../lib/rpc", () => ({
  rpc: { bots: { list: state.list }, threads: { send: state.send } },
}));
vi.mock("../lib/desktop", () => ({
  desktopBridge: () => ({
    quickAsk: { shortcut: "CommandOrControl+Shift+Space", close: state.close, sent: state.sent },
  }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }) };
});
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

import { QuickAskPage } from "./QuickAsk";

let unmount: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.userId = "owner";
  state.list.mockReset();
  state.send.mockReset();
  state.sent.mockReset();
  state.close.mockReset();
  state.send.mockResolvedValue({ taskId: "task", runId: "run", seq: 1 });
  state.sent.mockResolvedValue(undefined);
  state.close.mockResolvedValue(undefined);
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function render(path = "/quick-ask?bot=first") {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  unmount = async () => {
    await act(async () => root.unmount());
    div.remove();
  };
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <QuickAskPage />
      </MemoryRouter>,
    );
  });
  return div;
}

async function typeQuestion(div: HTMLElement, value: string) {
  const field = div.querySelector("textarea");
  if (!field) throw new Error("Missing question field");
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("sends the question to the open Mico and leaves the answer in that chat", async () => {
  state.list.mockResolvedValue([
    { id: "first", name: "Ada", archivedAt: null, pinned: false },
    { id: "pinned", name: "Pinned", archivedAt: null, pinned: true },
  ]);
  const div = await render();
  await vi.waitFor(() =>
    expect(div.querySelector("textarea")?.getAttribute("aria-label")).toBe("Ask Ada"),
  );
  await typeQuestion(div, "  What is next?  ");
  await act(async () => {
    div.querySelector("form")?.requestSubmit();
  });
  await vi.waitFor(() => expect(state.sent).toHaveBeenCalledWith("/app/first"));
  expect(state.send).toHaveBeenCalledWith(
    expect.objectContaining({ botId: "first", text: "What is next?" }),
  );
  const nonce = state.send.mock.calls[0]?.[0].clientNonce;
  expect(nonce).toEqual(expect.any(String));
  expect(state.sent).toHaveBeenCalledWith("/app/first");
  state.send.mockRejectedValueOnce(new Error("offline"));
  await typeQuestion(div, "Again");
  await act(async () => {
    div.querySelector("form")?.requestSubmit();
  });
  expect(state.send).toHaveBeenCalledTimes(1);
});

it("keeps a failed send on the same nonce and closes without sending", async () => {
  state.list.mockResolvedValue([{ id: "first", name: "Ada", archivedAt: null, pinned: false }]);
  state.send.mockRejectedValueOnce(new Error("offline"));
  const div = await render("/quick-ask");
  await vi.waitFor(() => expect(div.querySelector("textarea")).toBeTruthy());
  await typeQuestion(div, "Hello");
  await act(async () => {
    div.querySelector("form")?.requestSubmit();
  });
  await vi.waitFor(() => expect(div.textContent).toContain("Could not send. Try again."));
  const nonce = state.send.mock.calls[0]?.[0].clientNonce;
  state.send.mockResolvedValueOnce({ taskId: "task", runId: "run", seq: 1 });
  await act(async () => {
    div.querySelector("form")?.requestSubmit();
  });
  expect(state.send.mock.calls[1]?.[0].clientNonce).toBe(nonce);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(state.close).toHaveBeenCalled();
});

it("asks for sign-in instead of sending", async () => {
  state.userId = "";
  const div = await render();
  expect(div.textContent).toContain("Sign in to Mycellios to ask a Mico.");
  expect(div.querySelector("textarea")).toBeNull();
  await act(async () => {
    div.querySelector("button")?.click();
  });
  expect(state.sent).toHaveBeenCalledWith("/app");
  expect(state.send).not.toHaveBeenCalled();
});
