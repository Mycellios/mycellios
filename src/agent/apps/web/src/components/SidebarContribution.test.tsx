// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ status: vi.fn(), control: vi.fn(), enrollment: vi.fn(), native: vi.fn(), enroll: vi.fn(), identify: vi.fn(), bridge: vi.fn(), capabilities: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { models: { contributionStatus: f.status, contributionControl: f.control, contributionEnrollment: f.enrollment } } }));
vi.mock("../lib/auth-capabilities", () => ({ fetchAuthCapabilities: f.capabilities }));
vi.mock("../lib/desktop", () => ({ desktopBridge: f.bridge }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ Button: (props: object) => <button {...props} />, buttonVariants: () => "" }));
vi.mock("./BrowserContributionControl", () => ({ BrowserContributionControl: () => <button data-testid="browser-contribution-control" title="Contribute">Contribute</button> }));
import { SidebarContribution } from "./SidebarContribution";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(f)) mock.mockReset();
  f.capabilities.mockResolvedValue({ sso: { name: "Mycellios", availability: "available" } });
  f.bridge.mockReturnValue({ runtime: { status: f.native, enroll: f.enroll, identify: f.identify } });
  f.native.mockResolvedValue({ supported: true, enrolled: true, installed: true, nodeId: "same-node" });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false });
  f.control.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: "resume", rejected: false });
});
async function rendered(check: (host: HTMLDivElement) => Promise<void> | void, mini = false, expanded = false) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<SidebarContribution mini={mini} expanded={expanded} activationLabel={expanded ? "Activate contribution" : undefined} />)); await check(host); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
it("does not start compute on mount; starts the existing identity only after a click", async () => {
  await rendered(async host => {
    expect(f.control).not.toHaveBeenCalled(); expect(f.enrollment).not.toHaveBeenCalled();
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
    expect(host.textContent).toContain("Activating…");
    expect(host.querySelector("button")!.disabled).toBe(true);
  });
});

it("keeps unavailable browser contribution inline without starting compute or opening pages", async () => {
  f.bridge.mockReturnValue(undefined);
  await rendered(async host => {
    const contribute = host.querySelector<HTMLButtonElement>('[data-testid="browser-contribution-control"]')!;
    expect(contribute.disabled).toBe(false);
    expect(host.querySelector("a")).toBeNull();
    expect(f.control).not.toHaveBeenCalled(); expect(f.enrollment).not.toHaveBeenCalled();
    expect(f.native).not.toHaveBeenCalled();
  });
});

it("explains unavailable contribution in the collapsed sidebar", async () => {
  f.bridge.mockReturnValue(undefined);
  await rendered(async host => {
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.querySelector('[data-testid="browser-contribution-control"]')?.getAttribute("title")).toBe("Contribute");
  }, true);
});

it("does not offer a Desktop download inside the native app", async () => {
  await rendered(async host => { expect(host.querySelector('[aria-label="Get Mycellios Desktop"]')).toBeNull(); });
});
it("pauses confirmed contribution without inventing an earned balance", async () => {
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  await rendered(async host => {
    expect(host.textContent).toContain("Pause");
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
    expect(host.querySelector('[aria-label="Generate AI"]')?.textContent).toBe("Generate AIShare computing power with the network");
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
    expect(host.querySelector('[aria-label="Generate AI"]')?.textContent).toBe("Generate AIShare computing power with the network");
  });
});

it("offers browser contribution when the protected installation is missing its runtime", async () => {
  f.native.mockResolvedValue({ supported: true, enrolled: true, installed: false, nodeId: null });
  await rendered(async host => {
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    expect(host.querySelector('[data-testid="browser-contribution-control"]')).not.toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(f.status).not.toHaveBeenCalled();
    expect(f.identify).not.toHaveBeenCalled();
    expect(f.enrollment).not.toHaveBeenCalled();
    expect(f.control).not.toHaveBeenCalled();
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
    expect(host.querySelector('[aria-label="Generate AI"]')?.textContent).toBe("Generate AIShare computing power with the network");
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
    expect(f.control).not.toHaveBeenCalled(); expect(host.textContent).toContain("Pause");
  });
});
it("honors a click during a slow refresh and ignores its later stale result", async () => {
  let finish!: (value: object) => void;
  f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).toHaveBeenCalledExactlyOnceWith({ nodeId: "same-node", action: "resume" });
    await act(async () => finish({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false }));
    expect(host.textContent).toContain("Activating…");
  });
});

it("does not pause an already active contributor when its first status read is slow", async () => {
  let finish!: (value: object) => void;
  f.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Pause");
    await act(async () => finish({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false }));
    expect(host.textContent).toContain("Pause");
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
    expect(host.textContent).toContain("Activating…");
  });
});

it("never resumes a node when the user requested pause and it is already paused", async () => {
  f.status.mockResolvedValueOnce({ nodeId: "same-node", connected: true, enabled: true, pending: null, rejected: false });
  f.status.mockResolvedValue({ nodeId: "same-node", connected: true, enabled: false, pending: null, rejected: false });
  await rendered(async host => {
    await act(async () => host.querySelector("button")!.click());
    expect(f.control).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Generate AI"]')?.textContent).toBe("Generate AIShare computing power with the network");
  });
});

it("offers the browser path without polling or controlling a native node on a password-only Dev server", async () => {
  f.capabilities.mockResolvedValue({ sso: null, mycelliosAccount: false });
  await rendered(async host => {
    expect(f.native).not.toHaveBeenCalled();
    expect(f.status).not.toHaveBeenCalled();
    expect(f.control).not.toHaveBeenCalled();
    expect(f.enrollment).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[data-testid="browser-contribution-control"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    expect(host.querySelector("a")).toBeNull();
  });
});

it("exposes one direct contribution control without a disclosure", async () => {
 f.capabilities.mockResolvedValue({ sso: null });
 await rendered(host => {
   expect(host.querySelector("details")).toBeNull();
   expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
   expect(host.querySelector("a")).toBeNull();
   expect(f.control).not.toHaveBeenCalled();
 });
});

it("offers explicit activation in voice without a second disclosure or automatic compute", async () => {
 await rendered(async host => {
   expect(host.querySelector("details")).toBeNull();
   expect(host.querySelector('button[aria-label="Activate contribution"]')).not.toBeNull();
   expect(f.control).not.toHaveBeenCalled(); expect(f.enrollment).not.toHaveBeenCalled();
   await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
   expect(f.control).toHaveBeenCalledExactlyOnceWith({nodeId:"same-node",action:"resume"});
 }, false, true);
});

it("shows the warm activity indicator only for a connected, confirmed contributor", async () => {
 await rendered(async host => {
  expect(document.body.dataset.mycelliosContributing).not.toBe("true");
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.body.dataset.mycelliosContributing).not.toBe("true");
 });
 f.status.mockResolvedValue({nodeId:"same-node",connected:true,enabled:true,pending:null,rejected:false});
 await rendered(host=>{expect(host.querySelector('[data-active="true"]')).not.toBeNull(); expect(document.body.dataset.mycelliosContributing).toBe("true");});
 expect(document.body.dataset.mycelliosContributing).toBe("false");
 f.status.mockResolvedValue({nodeId:"same-node",connected:false,enabled:true,pending:null,rejected:false});
 await rendered(()=>expect(document.body.dataset.mycelliosContributing).not.toBe("true"));
});

it("clears the activity indicator when a previously active node cannot be verified", async () => {
 vi.useFakeTimers(); f.status.mockResolvedValueOnce({nodeId:"same-node",connected:true,enabled:true,pending:null,rejected:false}).mockRejectedValue(Error("offline"));
 try {await rendered(async()=>{
  expect(document.body.dataset.mycelliosContributing).toBe("true");
  await act(async()=>vi.advanceTimersByTimeAsync(10000));
  expect(document.body.dataset.mycelliosContributing).toBe("false");
 });}finally{vi.useRealTimers();}
});
