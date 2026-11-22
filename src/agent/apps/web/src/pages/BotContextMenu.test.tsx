// @vitest-environment jsdom
import { ContextMenu, ContextMenuTrigger } from "@mycellios/ui-web";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values) }),
}));
import { BotContextMenu } from "./BotContextMenu";

let root: ReturnType<typeof createRoot> | null = null;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { await act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

async function menu(bot: { unread: boolean }, conversationsUnread: boolean) {
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  const handlers = { onToggleUnread: vi.fn(), onMarkAllRead: vi.fn() };
  const noop = () => undefined;
  await act(() => root!.render(<ContextMenu open>
    <ContextMenuTrigger>Mico</ContextMenuTrigger>
    <BotContextMenu bot={{ name: "Mico", pinned: false, sectionId: null, ...bot }} sections={[]} onClose={noop} onTogglePinned={noop}
      onMoveToSection={noop} onCreateSection={noop} onEdit={noop} onDuplicate={noop} onClear={noop} onArchive={noop} onDelete={noop}
      conversationsUnread={conversationsUnread} {...handlers} />
  </ContextMenu>));
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  return { handlers, labels: items.map(item => item.textContent), item: (label: string) => items.find(item => item.textContent === label)! };
}

it("reads the main chat and its conversations with one Mark as Read", async () => {
  const view = await menu({ unread: true }, true);
  expect(view.labels).toContain("Mark as Read");
  expect(view.labels).not.toContain("Mark as Unread");
  await act(() => view.item("Mark as Read").click());
  expect(view.handlers.onMarkAllRead).toHaveBeenCalledOnce();
  expect(view.handlers.onToggleUnread).not.toHaveBeenCalled();
});

it("offers both when only its conversations have new replies", async () => {
  const view = await menu({ unread: false }, true);
  expect(view.labels.filter(label => label?.startsWith("Mark as"))).toEqual(["Mark as Read", "Mark as Unread"]);
  await act(() => view.item("Mark as Unread").click());
  expect(view.handlers.onToggleUnread).toHaveBeenCalledOnce();
});

it("only offers Mark as Unread when everything is read", async () => {
  const view = await menu({ unread: false }, false);
  expect(view.labels.filter(label => label?.startsWith("Mark as"))).toEqual(["Mark as Unread"]);
});
