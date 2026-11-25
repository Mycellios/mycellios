// @vitest-environment jsdom
import type { MessageQueueState } from "@mycellios/contracts";
import type { RenderAwaitingReplies } from "../../components/AwaitingReplies";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc, toast } = vi.hoisted(() => ({ rpc: {
  threads: {
    queueState: vi.fn(),
    queueSteer: vi.fn(async () => ({ ok: true })),
    queueSendNow: vi.fn(async () => ({ ok: true })),
    queueDelete: vi.fn(async () => ({ ok: true })),
    queueEdit: vi.fn(async () => ({ text: "Draft me", draft: null })),
    queueEditDraft: vi.fn(async () => ({ ok: true })),
    queueEditSave: vi.fn(async () => ({ ok: true })),
    queueEditCancel: vi.fn(async () => ({ ok: true, gone: false })),
    queueReorder: vi.fn(async () => ({ ok: true })),
    queueMove: vi.fn(async () => ({ threadId: "new-thread", runId: "run-new", title: "Plan the trip" })),
  },
}, toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@mycellios/ui-web/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("sonner", () => ({ toast }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => rpc, useBoundSpaceId: () => "space" }));
vi.mock("../../lib/use-artifact-image", () => ({ useArtifactImage: () => "blob:thumbnail" }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray, ...values: unknown[]) => s.reduce((text, part, index) => text + part + (values[index] ?? ""), "") }),
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) => <>{(value === 1 ? one : other).replace("#", String(value))}</>,
}));
vi.mock("@mycellios/ui-web", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Action = ({ children, onClick, disabled, ...rest }: { children?: ReactNode; onClick?: () => void; disabled?: boolean; "aria-label"?: string; title?: string }) =>
    <button type="button" onClick={onClick} disabled={disabled} aria-label={rest["aria-label"]} title={rest.title}>{children}</button>;
  return {
    Button: Action,
    DropdownMenu: Pass,
    DropdownMenuTrigger: () => null,
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div role="menu">{children}</div>,
    DropdownMenuItem: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) =>
      <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>,
    DropdownMenuSeparator: () => null,
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogContent: Pass,
    AlertDialogHeader: Pass,
    AlertDialogFooter: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogCancel: Action,
    AlertDialogAction: Action,
  };
});
import { movedOrder, QueuePanel, queueConflictCode } from "./queue-panel";

const row = (messageId: string, text: string, extra: Partial<MessageQueueState["messages"][number]> = {}) => ({
  messageId, text, createdAt: "2026-11-22T10:00:00.000Z", attachmentCount: 0, editing: null, canMove: true, ...extra,
});
const queue = (overrides: Partial<MessageQueueState> = {}): MessageQueueState => ({
  messages: [row("m1", "Check the invoices"), row("m2", "Then email Ana")],
  waiting: "busy",
  steer: { available: true },
  ...overrides,
});

let root: ReturnType<typeof createRoot> | undefined;
let node: HTMLDivElement;
beforeEach(() => {
  viewport.mobile = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(rpc.threads)) fn.mockClear();
  for (const fn of Object.values(toast)) fn.mockClear();
  localStorage.clear();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  node?.remove();
});
async function mount(state: MessageQueueState, props: { running?: boolean; onMoved?: (id: string, title: string) => void; onUseText?: (text: string) => void; renderAwaitingReplies?: RenderAwaitingReplies } = {}) {
  rpc.threads.queueState.mockResolvedValue(state);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  await act(async () => {
    root!.render(<QueuePanel target={{ botId: "mico" }} artifactTarget={{ botId: "mico" }} running={props.running ?? true} sending={false}
      onMoved={props.onMoved} onUseText={props.onUseText} renderAwaitingReplies={props.renderAwaitingReplies} />);
  });
  await act(async () => undefined);
}
const button = (label: string) => [...node.querySelectorAll("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
const click = async (label: string, index = 0) => {
  const matches = [...node.querySelectorAll("button")].filter((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  await act(async () => matches[index]!.click());
};

it("lists the waiting messages with why they wait and Steer now while a turn can take them", async () => {
  await mount(queue({ waiting: "slot", slots: { running: 4, limit: 4 } }));
  expect(node.querySelector("h3")?.textContent).toBe("Waiting to send · 2");
  expect(node.querySelector("[data-testid=message-queue-reason]")?.textContent).toBe("Waiting for a free slot: 4 conversations of this Mico are working.");
  expect([...node.querySelectorAll("[data-testid=queued-message]")].map((item) => item.textContent)).toEqual([
    expect.stringContaining("Check the invoices"), expect.stringContaining("Then email Ana"),
  ]);
  await click("Steer now");
  expect(rpc.threads.queueSteer).toHaveBeenCalledWith({ botId: "mico", messageId: "m1" });
  await click("Send now", 1);
  expect(rpc.threads.queueSendNow).toHaveBeenCalledWith({ botId: "mico", messageId: "m2" });
});

it("supplies one mobile queue to the replies surface with the first message preview", async () => {
  viewport.mobile = true;
  await mount(queue(), {
    renderAwaitingReplies: (queue) => <div data-testid="mobile-activity">{queue?.preview}{queue?.messages}</div>,
  });
  const activity = node.querySelector("[data-testid=mobile-activity]")!;
  expect(activity.firstChild?.textContent).toBe("Check the invoices");
  expect(activity.querySelectorAll("[data-testid=queued-message]")).toHaveLength(2);
  expect(node.querySelectorAll("[data-testid=message-queue]")).toHaveLength(1);
  await click("Send now", 1);
  expect(rpc.threads.queueSendNow).toHaveBeenCalledWith({ botId: "mico", messageId: "m2" });
});

it("marks the messages not steered, with the reason, during a routine", async () => {
  await mount(queue({ steer: { available: false, blocked: "routine" } }));
  expect(button("Steer now")).toBeUndefined();
  const badge = node.querySelector("[data-testid=queued-message-not-steered]");
  expect(badge?.textContent).toContain("Not steered");
  expect(badge?.getAttribute("title")).toBe("A routine is running now.");
  expect(button("Send now")).toBeDefined();
});

it("reorders a focused message with the arrow keys and refreshes a stale queue", async () => {
  await mount(queue());
  const first = node.querySelector<HTMLLIElement>("[data-testid=queued-message]")!;
  await act(async () => { first.focus(); first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(rpc.threads.queueReorder).toHaveBeenCalledWith({ botId: "mico", expected: ["m1", "m2"], order: ["m2", "m1"] });
  expect(node.querySelector("[role=status]")?.textContent).toBe("Moved to position 2 of 2.");
  rpc.threads.queueReorder.mockRejectedValueOnce(Object.assign(new Error("conflict"), { data: { queueCode: "stale" } }));
  const calls = rpc.threads.queueState.mock.calls.length;
  await click("Move down");
  expect(toast.error).toHaveBeenCalledWith("The queue changed meanwhile. It was refreshed; try again.");
  expect(rpc.threads.queueState.mock.calls.length).toBeGreaterThan(calls);
});

it("moves a message to a new conversation and opens it in the background", async () => {
  const onMoved = vi.fn();
  await mount(queue(), { onMoved });
  await click("Move to a new conversation");
  expect(rpc.threads.queueMove).toHaveBeenCalledWith({ botId: "mico", messageId: "m1" });
  expect(onMoved).toHaveBeenCalledWith("new-thread", "Plan the trip");
});

it("offers Move only for a message to this Mico alone", async () => {
  await mount(queue({ messages: [row("m1", "To the group", { canMove: false })] }));
  expect(button("Move to a new conversation")).toBeUndefined();
});

it("asks before deleting a message that is being edited somewhere else", async () => {
  await mount(queue({ messages: [row("m1", "Held", { editing: { holdId: "other-device", since: "2026-11-22T10:01:00.000Z", draft: null } })] }));
  expect(node.querySelector("[data-testid=queued-message-editing]")?.textContent).toBe("Being edited somewhere else");
  expect(button("Send now")).toBeUndefined();
  await click("Delete");
  expect(rpc.threads.queueDelete).not.toHaveBeenCalled();
  expect(node.querySelector("[role=alertdialog]")?.textContent).toContain("Delete queued message?");
  await click("Delete", 1);
  expect(rpc.threads.queueDelete).toHaveBeenCalledWith({ botId: "mico", messageId: "m1", force: true });
});

it("edits a message under a hold and keeps the text when it started meanwhile", async () => {
  const onUseText = vi.fn();
  await mount(queue(), { onUseText });
  await click("Edit");
  expect(rpc.threads.queueEdit).toHaveBeenCalledWith(expect.objectContaining({ botId: "mico", messageId: "m1", holdId: expect.any(String) }));
  const textarea = node.querySelector("textarea")!;
  expect(textarea.value).toBe("Draft me");
  rpc.threads.queueEditSave.mockRejectedValueOnce(Object.assign(new Error("conflict"), { data: { queueCode: "gone" } }));
  await click("Save");
  expect(node.querySelector("[role=alertdialog]")?.textContent).toContain("Edit not saved");
  await click("Put it in the message box");
  expect(onUseText).toHaveBeenCalledWith("Draft me");
});

it("reads conflict codes and computes moves", () => {
  expect(queueConflictCode({ data: { queueCode: "held" } })).toBe("held");
  expect(queueConflictCode({ data: { queueCode: "unknown" } })).toBeNull();
  expect(queueConflictCode(new Error("x"))).toBeNull();
  expect(movedOrder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  expect(movedOrder(["a", "b"], "a", 0)).toBeNull();
  expect(movedOrder(["a", "b"], "a", 5)).toBeNull();
});
