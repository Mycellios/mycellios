// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  state: vi.fn(), play: vi.fn(), stop: vi.fn(), add: vi.fn(), prepare: vi.fn(), inspect: vi.fn(), cancel: vi.fn(),
  requestAccess: vi.fn(), connect: vi.fn(), prepareTask: vi.fn(),
  t: (parts: TemplateStringsArray) => parts.join(""),
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: mocks.t }) }));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({ projectRunner: runner, computer }) }));
vi.mock("../lib/review-workspace", () => ({ useReviewWorkspace: () => ({ add: mocks.add }) }));
import { ProjectRunControls } from "./ProjectRunControls";
const runner = { state: mocks.state, play: mocks.play, stop: mocks.stop };
const computer = { requestAccess: mocks.requestAccess, connect: mocks.connect, prepareTask: mocks.prepareTask };
const idle = { phase: "idle", services: [], profiles: [], urls: [], logs: "" };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  mocks.state.mockResolvedValue(idle); mocks.requestAccess.mockResolvedValue(true); mocks.connect.mockResolvedValue(undefined); mocks.prepareTask.mockResolvedValue(undefined); mocks.prepare.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue({ status: "running", detail: "" }); mocks.cancel.mockResolvedValue({ ok: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async () => { await act(async () => root.render(<ProjectRunControls botId="bot" prepare={mocks.prepare} inspectPreparation={mocks.inspect} cancelPreparation={mocks.cancel} />)); };
const click = async (label: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()); };
it("binds the exact project conversation before starting its preview", async () => {
  mocks.play.mockResolvedValue({ ...idle, phase: "running" });
  await act(async () => root.render(<ProjectRunControls botId="bot" taskThreadId="task-one" prepare={mocks.prepare} />));
  await click("Run project");
  expect(mocks.prepareTask).toHaveBeenCalledExactlyOnceWith({ botId: "bot", taskThreadId: "task-one" });
  expect(mocks.prepareTask.mock.invocationCallOrder[0]).toBeLessThan(mocks.play.mock.invocationCallOrder[0]!);
});
it("does not start a preview when its conversation binding is refused", async () => {
  mocks.prepareTask.mockRejectedValue(new Error("The project account changed"));
  await act(async () => root.render(<ProjectRunControls botId="bot" taskThreadId="task-one" prepare={mocks.prepare} />));
  await click("Run project");
  expect(host.textContent).toContain("The project account changed");
  expect(mocks.play).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});
it("prepares once, waits for config, then opens the ready URL through the adjacent workspace", async () => {
  const prep = { id: "request", prompt: "prepare config" };
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  await render(); await click("Run project");
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("prepare config", "request");
  mocks.state.mockResolvedValue({ ...idle, phase: "configured", preparation: prep });
  mocks.play.mockResolvedValue({ ...idle, phase: "running", profile: "web", project: "Example", services: [{ id: "web", phase: "running", owned: true }], urls: [{ name: "Web", url: "http://localhost:5192/" }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mocks.play).toHaveBeenLastCalledWith({ botId: "bot", profile: undefined, preparationId: "request" });
  expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ url: "http://localhost:5192/", name: "Example" }));
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
});
it("does not prepare or run after native consent is refused", async () => {
  mocks.requestAccess.mockResolvedValue(false); await render(); await click("Run project");
  expect(mocks.play).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("waits for native connection without letting a disconnected state poll cancel Play", async () => {
  let finishConnection!: () => void;
  mocks.connect.mockReturnValue(new Promise<void>(resolve => { finishConnection = resolve; }));
  mocks.state.mockRejectedValue(new Error("Connect this agent to the local computer first"));
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "request", prompt: "prepare" } });
  await render(); await click("Run project");
  await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => { finishConnection(); });
  expect(mocks.play).toHaveBeenCalledExactlyOnceWith({ botId: "bot", profile: undefined });
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith("prepare", "request");
});
it("Stop cancels auto-start even if the preparation finishes later", async () => {
  const prep = { id: "request", prompt: "prepare" };
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  mocks.prepare.mockResolvedValue("aux-run");
  mocks.stop.mockResolvedValue({ ...idle, phase: "stopped" });
  await render(); await click("Run project"); await click("Stop project");
  mocks.state.mockResolvedValue({ ...idle, phase: "configured", preparation: prep });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mocks.play).toHaveBeenCalledTimes(1); expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("aux-run");
});
it.each([false, true])("recovers a timed-out status poll without a second preparation (stopped=%s)", async (stopped) => {
  const prep = { id: "request", prompt: "prepare" };
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  mocks.prepare.mockResolvedValue("aux-run");
  mocks.stop.mockResolvedValue({ ...idle, phase: "stopped" });
  await render(); await click("Run project");
  mocks.state.mockRejectedValueOnce(new Error("desktop.projectRunner.state: TimeoutError"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(host.textContent).toContain("Preparing configuration");
  if (stopped) await click("Stop project");
  mocks.state.mockResolvedValue({ ...idle, phase: "configured", preparation: prep });
  mocks.play.mockResolvedValue({ ...idle, phase: "running", urls: [{ name: "Web", url: "http://localhost:5192/" }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.play).toHaveBeenCalledTimes(stopped ? 1 : 2);
  expect(mocks.add).toHaveBeenCalledTimes(stopped ? 0 : 1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("does not resume auto-start after native access is revoked", async () => {
  const prep = { id: "request", prompt: "prepare" };
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  mocks.prepare.mockResolvedValue("aux-run");
  await render(); await click("Run project");
  mocks.state.mockRejectedValueOnce(new Error("Local computer access revoked"));
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  mocks.state.mockResolvedValue({ ...idle, phase: "configured", preparation: prep });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mocks.play).toHaveBeenCalledTimes(1);
  expect(mocks.add).not.toHaveBeenCalled();
  expect(host.textContent).toContain("access revoked");
});
it("renders actionable errors and retries preparation with the same idempotency key", async () => {
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "same", prompt: "prepare" } });
  mocks.prepare.mockRejectedValueOnce(new Error("Network unavailable"));
  await render(); await click("Run project"); expect(host.textContent).toContain("Network unavailable");
  await click("Run project"); expect(mocks.prepare.mock.calls.map(call => call[1])).toEqual(["same", "same"]);
});
it("reports a finished agent run that did not produce configuration", async () => {
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "request", prompt: "prepare" } });
  mocks.prepare.mockResolvedValue("run-id"); mocks.stop.mockResolvedValue({ ...idle, phase: "stopped" });
  mocks.state.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "request", prompt: "prepare" } });
  mocks.inspect.mockResolvedValue({ status: "failed", detail: "Missing local dependency" });
  await render();
  await click("Run project");
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(host.textContent).toContain("Configuration was not prepared");
  expect(host.textContent).not.toContain("Missing local dependency");
  await click("Service logs");
  expect(host.textContent).toContain("Missing local dependency");
  expect(mocks.stop).toHaveBeenCalledWith("bot"); expect(mocks.add).not.toHaveBeenCalled();
});

it("keeps the chat path unused when the auxiliary API is unavailable", async () => {
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "request", prompt: "technical setup" } });
  mocks.prepare.mockRejectedValue(new Error("Auxiliary preparation requires an updated server"));
  await render(); await click("Run project");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("updated server");
  expect(host.textContent).not.toContain("technical setup");
  expect(mocks.add).not.toHaveBeenCalled();
});

it("lets Stop retry a failed auxiliary cancellation without starting another preparation", async () => {
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: { id: "request", prompt: "prepare" } });
  mocks.prepare.mockResolvedValue("aux-run"); mocks.stop.mockResolvedValue({ ...idle, phase: "stopped" });
  mocks.cancel.mockRejectedValueOnce(new Error("Temporary cancellation failure"));
  await render(); await click("Run project"); await click("Stop project");
  expect(host.textContent).toContain("Temporary cancellation failure");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Run project"]')?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Stop project"]')?.disabled).toBe(false);
  await click("Stop project");
  expect(mocks.cancel).toHaveBeenCalledTimes(2);
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
});

it("starts a configuration written while the auxiliary status request was in flight", async () => {
  const prep = { id: "request", prompt: "prepare" };
  mocks.play.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  mocks.prepare.mockResolvedValue("aux-run");
  mocks.state.mockResolvedValue({ ...idle, phase: "preparing", preparation: prep });
  await render(); await click("Run project");
  mocks.inspect.mockImplementation(async () => {
    mocks.state.mockResolvedValue({ ...idle, phase: "configured", preparation: prep });
    return { status: "completed", detail: "Ready" };
  });
  mocks.play.mockResolvedValue({ ...idle, phase: "running" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(mocks.play).toHaveBeenLastCalledWith({ botId: "bot", profile: undefined, preparationId: "request" });
  expect(mocks.stop).not.toHaveBeenCalled();
});
