// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeveloperContextLink } from "./DeveloperContextLink";
const settings = vi.hoisted(() => ({ enabled: true }));
vi.mock("../lib/developer-mode", () => ({ useDeveloperMode: () => [settings.enabled, vi.fn()] }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
let host: HTMLDivElement, root: Root;
const write = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText: write } });
  write.mockReset().mockResolvedValue(undefined); settings.enabled = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (botId = "mico-1", threadId = "thread-1", runId = "run-1") => act(() => root.render(
  <DeveloperContextLink botId={botId} spaceId="space-1" threadId={threadId} taskThreadId={threadId} runId={runId} />,
));

it("only appears when developer mode is enabled and reacts to its changes", async () => {
  settings.enabled = false; await render(); expect(host.querySelector("button")).toBeNull();
  settings.enabled = true; await render(); expect(host.querySelector("button")).not.toBeNull();
  settings.enabled = false; await render(); expect(host.querySelector("button")).toBeNull();
});

it("copies the current execution without navigating or opening a panel", async () => {
  await render(); const before = window.location.href;
  await act(async () => host.querySelector("button")!.click());
  const url = new URL(write.mock.calls[0]![0]);
  expect(url.pathname).toBe("/app/mico-1");
  expect(Object.fromEntries(url.searchParams)).toEqual({ noticeSpace: "space-1", task: "thread-1", threadId: "thread-1", runId: "run-1" });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Debug link copied");
  expect(window.location.href).toBe(before);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("updates copied IDs and feedback after switching agents, conversations or runs", async () => {
  await render(); await act(async () => host.querySelector("button")!.click());
  await render("mico-2", "thread-2", "run-2");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("");
  await act(async () => host.querySelector("button")!.click());
  expect(write.mock.lastCall![0]).toContain("/app/mico-2?");
  expect(new URL(write.mock.lastCall![0]).searchParams.get("runId")).toBe("run-2");
});

it("reports denied or unavailable clipboard access honestly and allows retry", async () => {
  write.mockRejectedValueOnce(Error("Permission denied")); await render();
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Could not copy the link. Try again.");
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Debug link copied");
  vi.stubGlobal("navigator", {}); await render("mico-2");
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Could not copy the link. Try again.");
});
