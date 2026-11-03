// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn(), enrollment: vi.fn(), native: vi.fn(), enroll: vi.fn(), identify: vi.fn(), bridge: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { models: { contributionStatus: f.status, contributionControl: f.control, contributionEnrollment: f.enrollment } } }));
vi.mock("../lib/desktop", () => ({ desktopBridge: f.bridge }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ Button: (props: object) => <button {...props} />, buttonVariants: () => "" }));
import { SidebarContribution } from "./SidebarContribution";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(f)) mock.mockReset();
  f.bridge.mockReturnValue({ runtime: { status: f.native, enroll: f.enroll, identify: f.identify } });
  f.native.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false });
  f.control.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: "resume", rejected: false });
});
async function rendered(check: (host: HTMLDivElement) => Promise<void>, mini = false) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<SidebarContribution mini={mini} />)); await check(host); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
it("does not start compute on mount; starts the existing identity only after a click", async () => {
  await rendered(async host => {
    expect(f.control).not.toHaveBeenCalled(); expect(f.enrollment).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
    expect(host.textContent).toContain("Waiting for this computer");
    expect(host.querySelector("button")!.disabled).toBe(true);
  });
});

it("offers browser contribution without leaving or starting the current chat", async () => {
  f.bridge.mockReturnValue(undefined);
  await rendered(async host => {
    const contribute = host.querySelector<HTMLAnchorElement>('[aria-label="Contribute in browser"]')!;
    expect(contribute.href).toBe("https://www.mycellios.com/browser/");
    expect(contribute.target).toBe("_blank"); expect(contribute.rel).toContain("noopener");
    expect(f.control).not.toHaveBeenCalled(); expect(f.enrollment).not.toHaveBeenCalled();
    expect(f.native).not.toHaveBeenCalled();
  });
});

it("keeps browser contribution accessible in the collapsed sidebar", async () => {
  f.bridge.mockReturnValue(undefined);
  await rendered(async host => {
    expect(host.querySelectorAll("a[aria-label]")).toHaveLength(1);
    expect(host.querySelector('[aria-label="Contribute in browser"]')?.getAttribute("title")).toBe("Contribute in browser");
  }, true);
});

it("does not offer a Desktop download inside the native app", async () => {
  await rendered(async host => { expect(host.querySelector('[aria-label="Get Mycellios Desktop"]')).toBeNull(); });
});
it("pauses confirmed contribution without inventing an earned balance", async () => {
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  await rendered(async host => {
    expect(host.textContent).toContain("Pause contribution");
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "pause" });
  });
});
it("does not issue a second command while the first acknowledgement is pending", async () => {
  f.status.mockResolvedValue({ nodeId: "same-node", connected: false, enabled: false, pending: "resume", rejected: false });
  await rendered(async host => { await act(async () => host.querySelector("button")!.click()); expect(f.control).not.toHaveBeenCalled(); });
});
it("never overwrites an existing unreadable identity", async () => {
  f.native.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: null });
  f.identify.mockRejectedValue(new Error("Verification cancelled"));
  await rendered(async host => {
    expect(host.textContent).toContain("Verify this computer");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(f.identify).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(f.identify).toHaveBeenCalledOnce();
    expect(f.enrollment).not.toHaveBeenCalled(); expect(f.enroll).not.toHaveBeenCalled(); expect(f.control).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});

it("verifies the existing installation before offering a separate start action", async () => {
  f.native.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: null });
  f.identify.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
  await rendered(async host => {
    expect(f.status).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(f.identify).toHaveBeenCalledOnce();
    expect(f.enrollment).not.toHaveBeenCalled();
    expect(f.enroll).not.toHaveBeenCalled();
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Contribute compute");
    f.native.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
  });
});

it("keeps verification read-only when another process has already repaired the identity", async () => {
  f.native.mockResolvedValueOnce({ supported: true, enrolled: true, installed: true, nodeId: null });
  await rendered(async host => {
    expect(host.textContent).toContain("Verify this computer");
    await act(async () => host.querySelector("button")!.click());
    expect(f.identify).not.toHaveBeenCalled();
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Contribute compute");
  });
});

it("retries a failed observation without starting or enrolling compute", async () => {
  f.status.mockRejectedValueOnce(new Error("Offline"));
  await rendered(async host => {
    expect(host.querySelector("button")!.textContent).toContain("Retry");
    await act(async () => host.querySelector("button")!.click());
    expect(f.status).toHaveBeenCalledTimes(2);
    expect(f.control).not.toHaveBeenCalled();
    expect(f.identify).not.toHaveBeenCalled();
    expect(f.enrollment).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

it("refreshes a rejected command instead of replaying its effect", async () => {
  f.status.mockResolvedValueOnce({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: true });
  await rendered(async host => {
    expect(host.querySelector("button")!.textContent).toContain("Retry");
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Contribute compute");
  });
});
it("keeps a newly enrolled contributor running instead of immediately pausing it", async () => {
  f.native.mockResolvedValue({ supported: true, enrolled: false, installed: false, nodeId: null });
  f.enrollment.mockResolvedValue({ fixture: "grant" });
  f.enroll.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  await rendered(async host => {
    expect(f.enroll).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(f.enrollment).toHaveBeenCalledOnce(); expect(f.enroll).toHaveBeenCalledOnce();
    expect(f.control).not.toHaveBeenCalled(); expect(host.textContent).toContain("Pause contribution");
  });
});
it("honors a click during a slow refresh and ignores its later stale result", async () => {
  let finish!: (value: object) => void;
  f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
    await act(async () => finish({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false }));
    expect(host.textContent).toContain("Waiting for this computer");
  });
});

it("does not pause an already active contributor when its first status read is slow", async () => {
  let finish!: (value: object) => void;
  f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Pause contribution");
    await act(async () => finish({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false }));
    expect(host.textContent).toContain("Pause contribution");
  });
});

it("can request resume before the first worker observation instead of requiring a second click", async () => {
  f.native.mockResolvedValue({ supported: true, enrolled: false, installed: false, nodeId: null });
  f.enrollment.mockResolvedValue({ fixture: "grant" });
  f.enroll.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: null, pending: null, rejected: false });
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
    expect(host.textContent).toContain("Waiting for this computer");
  });
});

it("never resumes a node when the user requested pause and it is already paused", async () => {
  f.status.mockResolvedValueOnce({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false });
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Contribute compute");
  });
});
