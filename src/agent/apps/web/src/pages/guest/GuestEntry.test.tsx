// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ config: vi.fn(), eligible: vi.fn(() => true) }));
vi.mock("../../lib/guest-chat", async original => ({
  ...(await original<typeof import("../../lib/guest-chat")>()),
  guestApi: { config: f.config, status: vi.fn(), enter: vi.fn(), chat: vi.fn() },
  guestChatEligible: f.eligible,
}));
vi.mock("./GuestAccountPrompt", () => ({ GuestAccountPrompt: () => null }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (i < v.length ? String(v[i]) : ""), "") }),
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { GuestEntry, guestShellPath } from "./GuestEntry";
import { guestModeActive, leaveGuestMode } from "../../lib/guest-mode";

const limits = { messagesPerSession: 12, messageChars: 4000, historyMessages: 24, historyBytes: 98_304 };
const enabled = { enabled: true, limits, challenge: { token: "t", difficulty: 16, expiresAt: Date.now() + 60_000 } };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); leaveGuestMode();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); leaveGuestMode(); vi.unstubAllGlobals(); });

function Where() { const { pathname, search } = useLocation(); return <p data-where>{pathname + search}</p>; }
const render = async (path: string) => {
  await act(async () => root.render(<MemoryRouter key={path} initialEntries={[path]}><Routes>
    <Route path="*" element={<GuestEntry fallback={<p data-fallback>sign in</p>}><Where /></GuestEntry>} />
  </Routes></MemoryRouter>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

it("shows the ordinary shell in guest mode, inside the locked guest boundary", async () => {
  f.config.mockResolvedValue(enabled);
  await render("/app");
  expect(host.querySelector("[data-guest-shell] [data-where]")?.textContent).toBe("/app");
  expect(guestModeActive()).toBe(true);
});

it("keeps sign-in when guest chat is off, unavailable or not an ordinary browser tab", async () => {
  f.config.mockResolvedValue({ enabled: false });
  await render("/app");
  expect(host.querySelector("[data-fallback]")).not.toBeNull();
  expect(guestModeActive()).toBe(false);
  f.config.mockRejectedValue(new Error("offline"));
  await render("/app/");
  expect(host.querySelector("[data-fallback]")).not.toBeNull();
  f.eligible.mockReturnValue(false);
  await render("/app/guest-mico");
  expect(f.config).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-fallback]")).not.toBeNull();
});

it("drops deep links into features that need an account once a guest is in", async () => {
  f.eligible.mockReturnValue(true);
  f.config.mockResolvedValue(enabled);
  await render("/app");
  await render("/app/guest-mico?settings=models");
  expect(host.querySelector("[data-where]")?.textContent).toBe("/app/guest-mico");
});

it("limits guest mode to the shell routes of its one Mico", () => {
  expect(["/app", "/app/", "/app/guest-mico"].every(guestShellPath)).toBe(true);
  expect(["/app/artifacts", "/app/board", "/app/g", "/app/a/b", "/onboarding", "/sign-in"].some(guestShellPath)).toBe(false);
});
