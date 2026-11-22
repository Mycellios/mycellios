// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
// The real hook returns a stable client for the current scope.
const client = vi.hoisted(() => ({ mycelliosApiKeys: rpc }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
vi.mock("../../components/LoadingSkeleton", () => ({ LoadingSkeleton: () => <div role="status">Loading</div> }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), ""),
  i18n: { locale: "en" },
}) }));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant, size, ...props }: any) => <button {...props} />,
  Input: (props: any) => <input {...props} />,
  Badge: ({ variant, ...props }: any) => <span {...props} />,
  AlertDialog: ({ open, children }: any) => open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogCancel: ({ variant, size, ...props }: any) => <button {...props} />,
  AlertDialogAction: ({ variant, size, ...props }: any) => <button data-confirm {...props} />,
}));
import { ApiKeysSettingsPanel } from "./ApiKeysSettings";

const key = (id: string, name: string, usedByAgent = false) => ({
  id, name, prefix: `myc_live_${id}`, createdAt: "2026-11-01T10:00:00.000Z", lastUsedAt: null, revokedAt: null, usedByAgent,
});
let unmount: (() => Promise<void>) | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); });
afterEach(async () => { await unmount?.(); unmount = undefined; vi.unstubAllGlobals(); });
async function render(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  unmount = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node));
  return div;
}
const buttons = (div: HTMLElement, text: string) => [...div.querySelectorAll("button")].filter((b) => b.textContent?.includes(text));

it("protects Agent's own key and revokes another only after confirmation", async () => {
  rpc.list.mockResolvedValue({ apiBaseUrl: "https://www.mycellios.com/v1", keys: [key("agent", "Mycellios Agent", true), key("app", "My app")] });
  rpc.revoke.mockResolvedValue({ revoked: true });
  const div = await render(<ApiKeysSettingsPanel accountId="owner" />);
  expect(rpc.list).toHaveBeenCalledWith({ expectedUserId: "owner" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(div.textContent).toContain("https://www.mycellios.com/v1");
  expect(div.textContent).toContain("Used by Mycellios Agent");
  const revoke = buttons(div, "Revoke");
  expect(revoke).toHaveLength(1);
  expect(revoke[0]!.getAttribute("aria-label")).toBe("Revoke My app");
  await act(async () => revoke[0]!.click());
  expect(rpc.revoke).not.toHaveBeenCalled();
  await act(async () => div.querySelector<HTMLButtonElement>("[data-confirm]")!.click());
  expect(rpc.revoke).toHaveBeenCalledExactlyOnceWith({ expectedUserId: "owner", keyId: "app" });
  expect(div.textContent).not.toContain("My app");
  expect(div.textContent).toContain("Mycellios Agent");
});

it("shows a new secret once and forgets it when dismissed", async () => {
  rpc.list.mockResolvedValue({ apiBaseUrl: "https://www.mycellios.com/v1", keys: [] });
  rpc.create.mockResolvedValue({ key: key("cli", "CLI"), secret: "myc_live_cli_secret-value-for-test" });
  const div = await render(<ApiKeysSettingsPanel accountId="owner" />);
  const input = div.querySelector<HTMLInputElement>('input[aria-label="Key name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "CLI");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => div.querySelector("form")!.requestSubmit());
  expect(rpc.create).toHaveBeenCalledWith({ expectedUserId: "owner", name: "CLI" });
  expect(div.querySelector<HTMLInputElement>('input[readonly]')!.value).toBe("myc_live_cli_secret-value-for-test");
  await act(async () => buttons(div, "Done")[0]!.click());
  expect(div.innerHTML).not.toContain("secret-value-for-test");
});

it("explains a signed-out account without calling the API", async () => {
  const div = await render(<ApiKeysSettingsPanel />);
  expect(rpc.list).not.toHaveBeenCalled();
  expect(div.querySelector('[role="alert"]')!.textContent).toContain("sign in with your Mycellios account");
});
