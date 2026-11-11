// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ owner: "owner", listSessions: vi.fn(), revokeSession: vi.fn() }));
vi.mock("../../lib/auth", () => ({ authClient: {
  useSession: () => ({ data: { user: { id: auth.owner } } }),
  listSessions: auth.listSessions, $fetch: auth.revokeSession,
} }));
vi.mock("../../components/SessionConfirmation", () => ({ SessionConfirmation: ({ onConfirmed }: any) => <button onClick={() => void onConfirmed()}>Sign in again</button> }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), ""),
  i18n: { locale: "en" },
}) }));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant, size, ...props }: any) => <button {...props} />,
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
import { MobileSessions } from "./MobileSessions";
let unmount: (() => Promise<void>) | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); auth.owner = "owner"; vi.clearAllMocks(); });
afterEach(async () => { await unmount?.(); vi.unstubAllGlobals(); });
async function render(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  unmount = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node)); return div;
}
const phone = { id: "phone", token: "private-session-token", userAgent: "iPhone Safari", updatedAt: new Date(0) };
it("shows only mobile sessions, keeps tokens private and revokes only after confirmation", async () => {
  auth.listSessions.mockResolvedValue({ data: [phone, { ...phone, id: "pc", userAgent: "Windows Chrome" }] });
  auth.revokeSession.mockResolvedValue({ data: { status: true } });
  const div = await render(<MobileSessions accountId="owner" />);
  expect(div.textContent).toContain("iPhone");
  expect(div.textContent).not.toContain(phone.token);
  const buttons = () => [...div.querySelectorAll("button")].filter(b => b.textContent === "Disconnect");
  expect(buttons()).toHaveLength(1);
  await act(async () => buttons()[0]!.click());
  expect(auth.revokeSession).not.toHaveBeenCalled();
  await act(async () => div.querySelector<HTMLButtonElement>('[role="dialog"] button:last-child')!.click());
  expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith("/revoke-owned-session", { method: "POST", body: { sessionId: phone.id } });
  expect(div.textContent).toContain("No phones are signed in yet.");
});
it("explains stale sign-in and reloads sessions after confirmation", async () => {
  auth.listSessions.mockResolvedValueOnce({ error: { code: "SESSION_NOT_FRESH" } }).mockResolvedValue({ data: [phone] });
  const div = await render(<MobileSessions accountId="owner" />);
  expect(div.textContent).toContain("Confirm your account");
  expect(div.textContent).not.toContain("Could not load");
  await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Sign in again")!.click());
  expect(div.textContent).toContain("iPhone");
  expect(div.textContent).not.toContain("Confirm your account");
});
it("preserves the phone when revocation fails and does not load a different account", async () => {
  auth.listSessions.mockResolvedValue({ data: [phone] });
  auth.revokeSession.mockResolvedValue({ error: { message: "unavailable" } });
  const div = await render(<MobileSessions accountId="owner" />);
  await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Disconnect")!.click());
  await act(async () => div.querySelector<HTMLButtonElement>('[role="dialog"] button:last-child')!.click());
  expect(div.textContent).toContain("iPhone");
  expect(div.querySelector('[role="alert"]')?.textContent).toContain("Could not disconnect");
  await unmount!(); unmount = undefined;
  auth.listSessions.mockClear();
  const other = await render(<MobileSessions accountId="other" />);
  expect(other.textContent).toBe("");
  expect(auth.listSessions).not.toHaveBeenCalled();
});
