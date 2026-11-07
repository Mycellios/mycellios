// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Run } from "@rakazo/contracts";
vi.mock("@rakazo/ui-web/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray, ...values: unknown[]) => s.reduce((text, part, index) => text + part + (values[index] ?? ""), ""), i18n: { locale: "en" } }),
}));
vi.mock("@rakazo/ui-web", () => ({
  GroupAvatar: () => <span aria-hidden="true" />,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
import { RunActivityStatus } from "./RunActivityStatus";
const now = Date.parse("2026-01-01T12:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60000).toISOString();
const run = {
  id: "run",
  botId: "bot",
  threadId: "thread",
  taskId: "task",
  status: "running",
  trigger: "user",
  routineId: null,
  modelProvider: null,
  modelId: null,
  error: null,
  createdAt: at(-600),
  startedAt: at(-600),
  completedAt: null,
  updatedAt: at(-1),
  leaseExpiresAt: at(4),
  observedAt: at(0),
} as Run;
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
let root: ReturnType<typeof createRoot> | undefined;
let node: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  node?.remove();
  vi.useRealTimers();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
});
function mount(value: Run, missingComputer = false, messages: import("@rakazo/contracts").ThreadMessage[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  const refresh = vi.fn(async () => undefined);
  const open = vi.fn();
  act(() =>
    root!.render(
      <RunActivityStatus
        run={value}
        messages={messages}
        bots={[]}
        missingComputer={missingComputer}
        onRefresh={refresh}
        onOpenComputer={open}
      />,
    ),
  );
  return { refresh, open };
}
it("explains a preflight block instead of a working animation", () => {
  const { open } = mount({ ...run, startedAt: null }, true);
  expect(node.textContent).toContain("Cannot start: virtual computer unavailable");
  expect(node.textContent).toContain("No model has started");
  expect(node.querySelector("[role=status]")?.textContent).not.toContain("Working");
  act(() => node.querySelector("button")!.click());
  expect(open).toHaveBeenCalledOnce();
});
it("keeps a long, silent run active and distinguishes worker contact from output", () => {
  mount(run);
  expect(node.querySelector("details")?.open).toBe(false);
  expect(node.querySelector("[role=status]")?.textContent).toBe("Waiting for an activity update…");
  expect(node.textContent).toContain("Worker connected · no recent output");
  expect(node.textContent).toContain("A long task is not stopped");
  expect(node.textContent).toContain("Last worker signal");
  expect(node.textContent).toContain("Last output");
  expect(node.textContent).not.toContain("Cannot start");
});
it("polls without overlap, pauses while hidden and disposes on unmount", async () => {
  const { refresh } = mount(run);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  act(() => root!.unmount());
  root = undefined;
  await vi.advanceTimersByTimeAsync(90000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("does not overlap refreshes while a snapshot request is pending", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  let resolve!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  act(() =>
    root!.render(<RunActivityStatus run={run} messages={[]} bots={[]} onRefresh={refresh} />),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120000);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("old API snapshots never claim confirmed worker health", () => {
  mount({ ...run, updatedAt: undefined, observedAt: undefined, leaseExpiresAt: undefined });
  expect(node.querySelector("[role=status]")?.textContent).toBe(
    "Status not confirmed",
  );
});

it("shows real tool activity without claiming the worker is connected or opening diagnostics", () => {
  const message = { id: "progress:run", runId: "run", threadId: "thread", seq: 1,
    role: "bot", createdAt: at(-1), blocks: [{ kind: "steps", steps: [{ label: "List files", count: 1 }] }],
  } as import("@rakazo/contracts").ThreadMessage;
  mount({ ...run, leaseExpiresAt: undefined, observedAt: undefined }, false, [message]);
  expect(node.querySelector("[data-testid=latest-run-activity]")?.textContent).toBe("Latest activity: List files");
  expect(node.querySelector("[role=status]")?.textContent).toBe("Status not confirmed");
  expect(node.querySelector("details")?.open).toBe(false);
  expect(node.querySelector("details")?.contains(node.querySelector("[data-testid=latest-run-activity]"))).toBe(true);
});
it("does not show activity from another run or completed history", () => {
  const message = { id: "progress:other", runId: "other", threadId: "thread", seq: 1,
    role: "bot", createdAt: at(-1), blocks: [{ kind: "steps", steps: [{ label: "Shell", count: 1 }] }],
  } as import("@rakazo/contracts").ThreadMessage;
  mount(run, false, [message]);
  expect(node.querySelector("[data-testid=latest-run-activity]")).toBeNull();
});

it("keeps commands and paths inside details and preserves the disclosure choice on updates", () => {
  mount(run);
  const activity = 'Running: ssh -n jarvis-live "cd /srv/private/project && git status"';
  const render = () => root!.render(<RunActivityStatus run={run} messages={[]} bots={[]} activity={activity} onRefresh={async () => undefined} />);
  act(render);
  const details = node.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain(activity);
  const outside = node.cloneNode(true) as HTMLElement;
  outside.querySelector("details")!.remove();
  expect(outside.textContent).toContain("No new activity");
  expect(outside.textContent).not.toContain("ssh");
  expect(outside.textContent).not.toContain("/srv/");
  details.open = true;
  act(render);
  expect(node.querySelector("details")!.open).toBe(true);
});
it("shows seconds instead of zero minutes and omits the initial timer noise", () => {
  mount({...run, startedAt: new Date(now - 1000).toISOString()});
  expect(node.querySelector('[aria-label="Elapsed"]')).toBeNull();
  act(() => root!.render(<RunActivityStatus run={{...run, startedAt: new Date(now - 12000).toISOString()}} messages={[]} bots={[]} onRefresh={async () => undefined} />));
  expect(node.querySelector('[aria-label="Elapsed"]')?.textContent).toContain("12 sec");
});
