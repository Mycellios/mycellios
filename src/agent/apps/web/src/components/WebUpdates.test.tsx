// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  ready: "20261029170000" as string | null,
  apply: vi.fn(), desktop: false,
  t: (strings: TemplateStringsArray) => strings.join(""),
}));
vi.mock("../lib/client-update", () => {
  const tracker = { getSnapshot: () => mock.ready, subscribe: () => () => {}, applyUpdate: mock.apply };
  return { clientUpdates: () => tracker };
});
vi.mock("../lib/desktop", () => ({ desktopBridge: () => mock.desktop ? {} : null }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: mock.t }), Trans: ({children}: any) => children }));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({children, ...props}: any) => <button {...props}>{children}</button>,
}));
import { WebUpdates } from "./WebUpdates";
import { WebUpdateSlot } from "./web-update-slot";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.ready = "20261029170000"; mock.desktop = false; mock.apply.mockReset();
});
async function mounted(check: (refresh: () => Promise<void>) => Promise<void> | void) {
  const host = document.createElement("div"); const root = createRoot(host);
  document.body.append(host);
  const refresh = async () => { await act(async () => root.render(<StrictMode><WebUpdates /></StrictMode>)); };
  try { await refresh(); await check(refresh); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
const update = () => [...document.querySelectorAll("button")].find(b => b.textContent === "Update")!;
it("shows a persistent PWA prompt and updates only when clicked", async () => {
  mock.apply.mockResolvedValue(true);
  await mounted(async () => {
    expect(document.body.textContent).toContain("New version available");
    expect(document.body.textContent).toContain("Tasks running on the server will continue");
    expect(mock.apply).not.toHaveBeenCalled();
    await act(async () => update().click());
    expect(mock.apply).toHaveBeenCalledOnce();
  });
});
it("dismisses only the current version without applying it", async () => {
  await mounted(async (refresh) => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Not now")!;
    await act(async () => button.click());
    expect(document.querySelector("aside")).toBeNull();
    expect(mock.apply).not.toHaveBeenCalled();
    mock.ready = "20261029180000";
    await refresh();
    expect(document.body.textContent).toContain("New version available");
  });
});
it("leaves native desktop prompts independent", async () => {
  mock.desktop = true;
  await mounted(() => expect(document.querySelector("aside")).toBeNull());
});
it("waits for a verified version before showing the notice", async () => {
  mock.ready = null;
  await mounted(async (refresh) => {
    expect(document.querySelector("aside")).toBeNull();
    mock.ready = "20261029170000";
    await refresh();
    expect(document.querySelector("aside")).not.toBeNull();
  });
});
it.each([false, "reject"])("keeps the update retryable when local work or network blocks it (%s)", async (outcome) => {
  if (outcome === "reject") mock.apply.mockRejectedValue(new Error("offline"));
  else mock.apply.mockResolvedValue(false);
  await mounted(async () => {
    await act(async () => update().click());
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Send your draft and attachments");
    expect(update().disabled).toBe(false);
    mock.apply.mockResolvedValue(true);
    await act(async () => update().click());
    expect(mock.apply).toHaveBeenCalledTimes(2);
  });
});

it("moves the single notice into the sidebar and falls back when the sidebar closes", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<><WebUpdateSlot /><WebUpdates /></>));
    expect(document.querySelectorAll("aside")).toHaveLength(1);
    expect(document.querySelector('[data-testid="sidebar-web-update"] aside')).not.toBeNull();
    expect(mock.apply).not.toHaveBeenCalled();
    await act(async () => root.render(<WebUpdates />));
    expect(document.querySelectorAll("aside")).toHaveLength(1);
    expect(document.querySelector("aside")?.className).toContain("fixed");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
