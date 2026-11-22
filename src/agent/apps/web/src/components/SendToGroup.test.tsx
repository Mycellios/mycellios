// @vitest-environment jsdom
import type { ThreadMessage } from "@mycellios/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
    i18n: { locale: "en" },
  }),
}));
vi.mock("../lib/general-preferences", () => ({
  useGeneralPreferences: () => ({ compactMessageActions: true }),
}));

import { MessageHoverActions, MessageTouchActions } from "../pages/shell/message-hover-actions";
import { SendToGroupContext } from "./SendToGroup";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
});

const message: ThreadMessage = {
  id: "message",
  threadId: "thread",
  seq: 0,
  role: "bot",
  blocks: [{ kind: "text", text: "Here is the launch plan." }],
  createdAt: new Date(0).toISOString(),
};
const groups = [
  { id: "group-1", name: "Launch" },
  { id: "group-2", name: "Support" },
];
const clickable = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(
    (item) => item.textContent === text,
  );

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

it("sends a message's text to a group from the touch actions", async () => {
  const send = vi.fn();
  await mount(
    <SendToGroupContext.Provider value={{ groups, send }}>
      <MessageTouchActions
        message={message}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      >
        <p>Here is the launch plan.</p>
      </MessageTouchActions>
    </SendToGroupContext.Provider>,
  );
  await act(async () => clickable("Message actions")!.click());
  expect(clickable("Send to Support")).toBeTruthy();
  await act(async () => clickable("Send to Launch")!.click());
  expect(send).toHaveBeenCalledWith("group-1", "Here is the launch plan.");
});

it("offers Send to group in the message menu", async () => {
  const send = vi.fn();
  const host = await mount(
    <SendToGroupContext.Provider value={{ groups, send }}>
      <MessageHoverActions
        message={message}
        side="end"
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />
    </SendToGroupContext.Provider>,
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click(),
  );
  expect(document.querySelector('[data-testid="send-to-group"]')?.textContent).toContain(
    "Send to group",
  );
});

it("leaves Send to group out of the message menu without groups", async () => {
  const bare = await mount(
    <MessageHoverActions
      message={message}
      side="end"
      onReply={vi.fn()}
      onMarkUnread={vi.fn()}
      onReact={vi.fn()}
    />,
  );
  await act(async () =>
    bare.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click(),
  );
  expect(document.querySelector('[data-testid="send-to-group"]')).toBeNull();
});
