// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mycellios.com/app/"}
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ url: "https://mycellios.com/app/", copied: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (p: TemplateStringsArray) => p.join("") }) }));
vi.mock("./MobileSessions", () => ({ MobileSessions: ({ onAddPhone, permanentLink }: any) => <><button onClick={onAddPhone}>Add phone</button>{permanentLink}</> }));
vi.mock("../../components/MobileInstallOffer", () => ({ mobileInstallUrl: () => mock.url, MobileInstallOffer: ({ open }: any) => open ? <p>Install guide</p> : null }));
vi.mock("../../components/ServerLinkCode", () => ({ ServerLinkCode: ({ url }: any) => <a data-testid="qr">{url}</a> }));
vi.mock("@rakazo/ui-web", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Button: ({ variant, ...props }: any) => <button {...props} />, Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
    DialogContent: Wrapper, DialogDescription: Wrapper, DialogHeader: Wrapper, DialogTitle: Wrapper };
});
import { MobileSettingsPanel } from "./MobileConnectionSettings";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("shares the server entry without auth data and copies only after a user action", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mock.copied.mockResolvedValue(undefined) } });
  await act(async () => root.render(<MobileSettingsPanel accountId="owner" />)); expect(mock.copied).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Permanent linkFor a phone you sign in to regularly.")!.click());
  expect(host.querySelector('[data-testid="qr"]')?.textContent).toBe(mock.url);
  expect(host.textContent).toContain("contains no password or session token");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Copy link")!.click());
  expect(mock.copied).toHaveBeenCalledWith("https://mycellios.com/app/"); expect(host.textContent).toContain("Link copied");
});
