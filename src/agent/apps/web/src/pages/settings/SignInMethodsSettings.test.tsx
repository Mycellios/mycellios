// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ list: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
const client = vi.hoisted(() => ({ mycelliosIdentities: rpc }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
vi.mock("../../components/LoadingSkeleton", () => ({ LoadingSkeleton: () => <div role="status">Loading</div> }));
vi.mock("../../components/SettingsRows", () => ({
  SettingsGroup: ({ title, children }: any) => <section><h3>{title}</h3>{children}</section>,
  SettingsRow: ({ label, description, control }: any) => <div data-row={label}>{label}<p>{description}</p>{control}</div>,
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), ""),
}) }));
vi.mock("@mycellios/ui-web", () => {
  const Pass = ({ children }: any) => <>{children}</>;
  return {
    Button: ({ variant, size, ...props }: any) => <button {...props} />,
    AlertDialog: ({ open, children }: any) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogContent: Pass, AlertDialogHeader: Pass, AlertDialogFooter: Pass,
    AlertDialogTitle: Pass, AlertDialogDescription: Pass,
    AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    AlertDialogAction: ({ variant, children, ...props }: any) => <button data-confirm {...props}>{children}</button>,
  };
});
import { IDENTITY_LINK_STORAGE_KEY } from "../../lib/identity-link-return";
import { SignInMethodsSettings } from "./SignInMethodsSettings";

const methods = (identities: { id: string; provider: string; email: string | null }[]) => ({
  available: { google: true, twitter: true }, identities,
});
const email = { id: "id-email", provider: "email", email: "owner@example.test" };
const google = { id: "id-google", provider: "google", email: "owner@gmail.test" };

let unmount: (() => Promise<void>) | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); });
afterEach(async () => { await unmount?.(); unmount = undefined; vi.unstubAllGlobals(); window.sessionStorage.clear(); });
async function render(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  unmount = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node));
  return div;
}
const button = (div: HTMLElement, label: string) =>
  [...div.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label);

it("shows Google and X with their state for this account", async () => {
  rpc.list.mockResolvedValue(methods([email, google]));
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={vi.fn()} />);
  expect(rpc.list).toHaveBeenCalledWith({ expectedUserId: "owner" }, expect.anything());
  expect(div.textContent).toContain("Sign-in methods");
  expect(div.querySelector('[data-row="Google"]')?.textContent).toContain("Linked as owner@gmail.test");
  expect(div.querySelector('[data-row="X"]')?.textContent).toContain("Not linked");
  expect(button(div, "Unlink Google")?.disabled).toBe(false);
});

it("starts linking with a remembered state and follows only the returned provider page", async () => {
  rpc.list.mockResolvedValue(methods([email]));
  rpc.link.mockResolvedValue({ url: "https://api.twitter.com/oauth/authenticate?oauth_token=t" });
  const navigate = vi.fn();
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={navigate} />);
  await act(async () => button(div, "Link X")!.click());
  const pending = JSON.parse(window.sessionStorage.getItem(IDENTITY_LINK_STORAGE_KEY) ?? "null");
  expect(pending).toMatchObject({ provider: "twitter", state: expect.stringMatching(/^[a-f0-9]{32}$/) });
  expect(rpc.link).toHaveBeenCalledWith({ expectedUserId: "owner", provider: "twitter", state: pending.state });
  expect(navigate).toHaveBeenCalledWith("https://api.twitter.com/oauth/authenticate?oauth_token=t");
});

it("forgets the attempt and explains a failed link", async () => {
  rpc.list.mockResolvedValue(methods([email]));
  rpc.link.mockRejectedValue(Object.assign(new Error("down"), { code: "SERVICE_UNAVAILABLE" }));
  const navigate = vi.fn();
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={navigate} />);
  await act(async () => button(div, "Link Google")!.click());
  expect(navigate).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(IDENTITY_LINK_STORAGE_KEY)).toBeNull();
  expect(div.querySelector('[role="alert"]')?.textContent).toBe("Could not link Google. Try again.");
});

it("never offers to unlink the only sign-in method", async () => {
  rpc.list.mockResolvedValue(methods([google]));
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={vi.fn()} />);
  const unlink = button(div, "Unlink Google")!;
  expect(unlink.disabled).toBe(true);
  expect(unlink.title).toBe("This is your only sign-in method.");
});

it("unlinks after confirmation and removes the row's link", async () => {
  rpc.list.mockResolvedValue(methods([email, google]));
  rpc.unlink.mockResolvedValue({ unlinked: true });
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={vi.fn()} />);
  await act(async () => button(div, "Unlink Google")!.click());
  expect(div.querySelector('[role="alertdialog"]')?.textContent).toContain("Unlink Google?");
  await act(async () => (div.querySelector("[data-confirm]") as HTMLButtonElement).click());
  expect(rpc.unlink).toHaveBeenCalledWith({ expectedUserId: "owner", identityId: "id-google" });
  expect(div.querySelector('[data-row="Google"]')?.textContent).toContain("Not linked");
  expect(div.querySelector('[role="alertdialog"]')).toBeNull();
});

it("shows nothing where Mycellios sign-in is not available", async () => {
  rpc.list.mockRejectedValue(Object.assign(new Error("off"), { code: "PRECONDITION_FAILED" }));
  const div = await render(<SignInMethodsSettings accountId="owner" navigate={vi.fn()} />);
  expect(div.textContent).toBe("");
});
