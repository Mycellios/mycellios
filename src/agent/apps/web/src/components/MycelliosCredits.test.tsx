// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { readAccount } = vi.hoisted(() => ({ readAccount: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { models: { mycelliosAccount: readAccount } } }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join(""), i18n: { locale: "es" } }) }));
import { MycelliosCredits } from "./MycelliosCredits";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); readAccount.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function rendered(check: (host: HTMLDivElement) => Promise<void> | void) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<MycelliosCredits ownerId="owner-a" />)); await check(host); }
  finally { await act(async () => root.unmount()); host.remove(); }
}
it("shows available contribution credits as Credits using the selected language", async () => {
  readAccount.mockResolvedValue({ balanceMicrounits: 12500000, availableMicrounits: 10250000 });
  await rendered(host => { expect(host.textContent).toBe("Credits10,25"); expect(host.textContent).not.toContain("USD"); });
});
it("keeps an actual zero distinct from an unavailable account", async () => {
  readAccount.mockResolvedValue({ balanceMicrounits: 0, availableMicrounits: 0 });
  await rendered(host => expect(host.textContent).toBe("Credits0"));
  readAccount.mockResolvedValue(null);
  await rendered(host => expect(host.textContent).toBe("Credits—"));
});
it("keeps the row visible while loading and on failure", async () => {
  readAccount.mockReturnValue(new Promise(() => {}));
  await rendered(host => { expect(host.textContent).toBe("Credits…"); expect(host.firstElementChild?.getAttribute("aria-busy")).toBe("true"); });
  readAccount.mockRejectedValue(new Error("offline"));
  await rendered(host => expect(host.textContent).toBe("Credits—Retrying…"));
});
it("refreshes the real balance when the window receives focus", async () => {
  readAccount.mockResolvedValueOnce({ balanceMicrounits: 1000000 }).mockResolvedValueOnce({ balanceMicrounits: 2000000 });
  await rendered(async host => { expect(host.textContent).toBe("Credits1"); await act(async () => window.dispatchEvent(new Event("focus"))); expect(host.textContent).toBe("Credits2"); });
});

it("identifies private sandbox credits without presenting them as production Credits", async () => {
  readAccount.mockResolvedValue({ balanceMicrounits: 1000000, environment: "sandbox" });
  await rendered(host => expect(host.textContent).toBe("Test credits1"));
});

it("identifies a promotional allocation separately from earned credits", async () => {
  readAccount.mockResolvedValue({ balanceMicrounits: 999000, availableMicrounits: 999000, promotionalGrantedMicrounits: 1000000, contributionEarnedMicrounits: 0 });
  await rendered(host => { expect(host.textContent).toBe("Credits0,999Promo"); expect(host.querySelector('[title="Promotional grant, separate from earned credits"]')).not.toBeNull(); });
});

it("preserves the existing micro-unit balance and explains the distinct units", async () => {
  readAccount.mockResolvedValue({ balanceMicrounits: 954188, availableMicrounits: 954188 });
  await rendered(host => {
    expect(host.textContent).toBe("Credits0,954188");
    expect(host.firstElementChild?.getAttribute("title")).toContain("Adding 10 USD gives you 10 credits");
    expect(host.firstElementChild?.getAttribute("title")).toContain("Spore is a separate token");
  });
});

it("recovers an initial timeout after two seconds without inventing a zero balance", async () => {
  vi.useFakeTimers();
  readAccount.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ balanceMicrounits: 954188 });
  await rendered(async host => {
    expect(host.textContent).toBe("Credits—Retrying…");
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(readAccount).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(host.textContent).toBe("Credits0,954188");
    expect(readAccount).toHaveBeenCalledTimes(2);
    expect(host.firstElementChild?.getAttribute("data-balance-status")).toBe("ready");
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the last verified balance and promo explicitly stale until recovery", async () => {
  vi.useFakeTimers();
  readAccount.mockResolvedValueOnce({ balanceMicrounits: 954188, promotionalGrantedMicrounits: 1000000 })
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValue({ balanceMicrounits: 900000, promotionalGrantedMicrounits: 1000000 });
  await rendered(async host => {
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toBe("Credits0,954188Refreshing…Promo");
    expect(host.firstElementChild?.getAttribute("data-balance-status")).toBe("stale");
    expect(host.firstElementChild?.getAttribute("title")).toBe("Last verified balance. Retrying automatically.");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(host.textContent).toBe("Credits0,9Promo");
  });
});

it("backs off repeated failures and resumes normal polling after success", async () => {
  vi.useFakeTimers();
  readAccount.mockRejectedValue(new Error("offline"));
  await rendered(async host => {
    for (const [delay, count] of [[2_000,2],[5_000,3],[15_000,4],[60_000,5]] as const) {
      await act(async () => vi.advanceTimersByTimeAsync(delay));
      expect(readAccount).toHaveBeenCalledTimes(count);
    }
    readAccount.mockResolvedValue({ balanceMicrounits: 1000000 });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(host.textContent).toBe("Credits1");
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(readAccount).toHaveBeenCalledTimes(6);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(readAccount).toHaveBeenCalledTimes(7);
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces focus events without overlapping or losing the final refresh", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  readAccount.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ balanceMicrounits: 2000000 });
  await rendered(async host => {
    await act(async () => { for (let i=0;i<12;i++) window.dispatchEvent(new Event("focus")); });
    expect(readAccount).toHaveBeenCalledTimes(1);
    await act(async () => finish({ balanceMicrounits: 1000000 }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(readAccount).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe("Credits2");
  });
});

it.each(["UNAUTHORIZED","FORBIDDEN"])("clears cached money on %s and does not retry aggressively", async code => {
  vi.useFakeTimers();
  readAccount.mockResolvedValueOnce({ balanceMicrounits: 954188, promotionalGrantedMicrounits: 1000000 })
    .mockRejectedValue({ code });
  await rendered(async host => {
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toBe("Credits—");
    expect(host.firstElementChild?.getAttribute("title")).toBe("Sign in again to see your credits.");
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(readAccount).toHaveBeenCalledTimes(2);
  });
});

it("aborts old identity reads and never applies their late balance to another user", async () => {
  let finish!: (value: unknown) => void;
  readAccount.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ balanceMicrounits: 2000000 });
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try {
    await act(async () => root.render(<MycelliosCredits ownerId="owner-a" />));
    const signal=readAccount.mock.calls[0]![1].signal as AbortSignal;
    await act(async () => root.render(<MycelliosCredits ownerId="owner-b" />));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ balanceMicrounits: 999999999 }));
    expect(host.textContent).toBe("Credits2");
    await act(async () => root.render(<MycelliosCredits ownerId="" />));
    expect(host.textContent).toBe("Credits—");
    expect(readAccount).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount());host.remove(); }
});

it("clears a previously verified account when the authority returns null", async () => {
  readAccount.mockResolvedValueOnce({ balanceMicrounits: 954188 }).mockResolvedValue(null);
  await rendered(async host => {
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toBe("Credits—");
    expect(host.firstElementChild?.getAttribute("data-balance-status")).toBe("unavailable");
  });
});

it("bounds a hung read and cancels all pending work on unmount", async () => {
  vi.useFakeTimers();
  readAccount.mockImplementation((_input, {signal}: {signal: AbortSignal}) => new Promise((_resolve,reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), {once:true});
  }));
  await rendered(async host => {
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    expect(host.textContent).toBe("Credits—Retrying…");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(readAccount).toHaveBeenCalledTimes(2);
  });
  expect(vi.getTimerCount()).toBe(0);
});
