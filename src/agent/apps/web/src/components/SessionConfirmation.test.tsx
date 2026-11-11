// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ social: vi.fn(), current: vi.fn(), capabilities: vi.fn() }));
vi.mock("../lib/auth", () => ({ authClient: {
  useSession: () => ({ data: { user: { id: "owner", email: "owner@example.test" } } }),
  getSession: f.current, signIn: { social: f.social },
} }));
vi.mock("../lib/auth-capabilities", () => ({ fetchAuthCapabilities: f.capabilities }));
vi.mock("../lib/account-security", () => ({ fetchAccountSecurity: async () => ({ hasPassword: false, ssoLinked: true }) }));
vi.mock("../lib/sso-flow", () => ({ runSsoFlow: (begin: any) => begin(true, (url: string) => url) }));
vi.mock("./PasskeySignIn", () => ({ PasskeySignIn: () => null }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant, size, ...props }: any) => <button {...props} />,
  Input: (props: any) => <input {...props} />, Label: (props: any) => <label {...props} />,
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
import { SessionConfirmation } from "./SessionConfirmation";
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  f.capabilities.mockResolvedValue({ passwordAuth: false, sso: { availability: "available" } });
  f.social.mockResolvedValue({ data: {}, error: null });
  f.current.mockResolvedValue({ data: { user: { id: "owner" } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function confirm(onConfirmed: () => Promise<void>) {
  await act(async () => root.render(<SessionConfirmation accountId="owner" onConfirmed={onConfirmed} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Continue with your account")!.click());
}
it("requests bound SSO reauthentication and reloads phones only for the original account", async () => {
  const done = vi.fn(async () => undefined); await confirm(done);
  expect(f.social).toHaveBeenCalledWith(expect.objectContaining({ provider: "oidc", additionalData: { reauthenticate: true } }));
  expect(f.current).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  expect(done).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("does not load phone sessions when a different account completes sign-in", async () => {
  f.current.mockResolvedValue({ data: { user: { id: "other" } } });
  const done = vi.fn(async () => undefined); await confirm(done);
  expect(done).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("account changed");
});
