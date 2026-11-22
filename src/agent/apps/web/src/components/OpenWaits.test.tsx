// @vitest-environment jsdom
import type { OpenWait } from "@mycellios/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));
import { OpenWaits } from "./OpenWaits";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

const base = {
  threadId: "main", openedAt: "2026-11-22T10:00:00.000Z", expiresAt: "2026-11-23T10:00:00.000Z", timeoutMinutes: 1440,
};
const routineWait: OpenWait = { ...base, waitId: "wait-routine", note: "Read the nightly report and send the summary.",
  request: "Summarise tonight's report when it lands.", routineId: "routine-1", routineName: "Nightly report", status: "waiting" };
const timeWait: OpenWait = { ...base, waitId: "wait-time", note: "Check the deploy again.", request: "Deploy and confirm.",
  resumeAt: "2026-11-22T12:00:00.000Z", status: "paused" };
const runWait: OpenWait = { ...base, waitId: "wait-run", note: "Compare the results.", request: "", runId: "run-9",
  status: "continuing", outcome: "ready", settledAt: "2026-11-22T11:00:00.000Z" };

function render(lists: OpenWait[][], cancel = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const waits = vi.fn();
  for (const list of lists) waits.mockResolvedValueOnce(list);
  waits.mockResolvedValue(lists.at(-1) ?? []);
  const rpc = { tasks: { waits, cancelWait: cancel } } as never;
  const draw = (refreshKey = "run-1:completed", threadId = "main") =>
    act(() => root.render(<OpenWaits rpc={rpc} botId="mico" threadId={threadId} refreshKey={refreshKey} />));
  return { host, waits, cancel, draw };
}
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find(item => item.textContent === label);

describe("Open waits card", () => {
  it("shows nothing when the conversation has no open wait", async () => {
    const view = render([[]]);
    await view.draw();
    await flush();
    expect(view.waits).toHaveBeenCalledWith({ botId: "mico", threadId: "main" });
    expect(view.host.querySelector("[data-testid=open-waits]")).toBeNull();
  });

  it("lists what each wait is for, its state and its timeout, and cancels only those that have not woken", async () => {
    const view = render([[routineWait, timeWait, runWait]]);
    await view.draw();
    await flush();
    const card = view.host.querySelector("[data-testid=open-waits]")!;
    expect(card.getAttribute("aria-label")).toBe("Open waits");
    const rows = [...card.querySelectorAll("[data-open-wait]")];
    expect(rows.map(row => row.getAttribute("data-wait-status"))).toEqual(["waiting", "paused", "continuing"]);
    expect(rows[0]!.textContent).toContain("Waits for the next run of Nightly report");
    expect(rows[0]!.textContent).toContain("Waiting");
    expect(rows[0]!.textContent).toContain("Times out");
    expect(rows[1]!.textContent).toContain("Waits until");
    expect(rows[1]!.textContent).toContain("Paused");
    expect(rows[2]!.textContent).toContain("Waits for a run to finish");
    expect(rows[2]!.textContent).toContain("Continuing the request");
    expect(rows.map(row => [...row.querySelectorAll("button")].some(item => item.textContent === "Cancel the wait")))
      .toEqual([true, true, false]);
  });

  it("shows the saved note and the original request", async () => {
    const view = render([[routineWait]]);
    await view.draw();
    await flush();
    const row = view.host.querySelector("[data-open-wait=wait-routine]")!;
    expect(row.textContent).toContain("Show the request");
    expect(row.textContent).toContain("Saved note");
    expect(row.textContent).toContain(routineWait.note);
    expect(row.textContent).toContain("Original request");
    expect(row.textContent).toContain(routineWait.request);
  });

  it("removes a cancelled wait and reads the list again", async () => {
    const cancel = vi.fn().mockResolvedValue({ waitId: "wait-routine", closed: true, alreadyClosed: false, status: "closed" });
    const view = render([[routineWait], []], cancel);
    await view.draw();
    await flush();
    await act(async () => button(view.host, "Cancel the wait")!.click());
    await flush();
    expect(cancel).toHaveBeenCalledWith({ waitId: "wait-routine" });
    expect(view.waits).toHaveBeenCalledTimes(2);
    expect(view.host.querySelector("[data-testid=open-waits]")).toBeNull();
  });

  it("never claims a cancellation when the wait had already woken", async () => {
    const cancel = vi.fn().mockResolvedValue({ waitId: "wait-routine", closed: false, alreadyClosed: false, status: "woke" });
    const view = render([[routineWait], [{ ...routineWait, status: "woke", outcome: "ready" }]], cancel);
    await view.draw();
    await flush();
    await act(async () => button(view.host, "Cancel the wait")!.click());
    await flush();
    const row = view.host.querySelector("[data-open-wait=wait-routine]")!;
    expect(row.querySelector("[role=alert]")?.textContent).toBe("This wait already woke, so it was not cancelled. Its request goes on.");
    expect(row.getAttribute("data-wait-status")).toBe("woke");
    expect(row.textContent).toContain("Woke");
    expect(button(view.host, "Cancel the wait")).toBeUndefined();
  });

  it("keeps the wait and explains when the cancellation fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("network"));
    const view = render([[routineWait]], cancel);
    await view.draw();
    await flush();
    await act(async () => button(view.host, "Cancel the wait")!.click());
    await flush();
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe("The wait could not be cancelled. Try again.");
    expect(view.host.querySelector("[data-open-wait=wait-routine]")).not.toBeNull();
  });

  it("reads again when the turn moves or the conversation changes, and checks open waits while visible", async () => {
    vi.useFakeTimers();
    const view = render([[routineWait]]);
    await view.draw();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.waits).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(view.waits).toHaveBeenCalledTimes(2);
    await view.draw("run-2:running");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.waits).toHaveBeenCalledTimes(3);
    await view.draw("run-2:running", "side");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.waits).toHaveBeenLastCalledWith({ botId: "mico", threadId: "side" });
  });
});
