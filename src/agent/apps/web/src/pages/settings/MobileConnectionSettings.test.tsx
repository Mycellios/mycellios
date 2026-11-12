// @vitest-environment jsdom
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
it("does not create a cloud QR or copyable loopback address for a local preview", async () => {
  await act(async () => root.render(<MobileSettingsPanel accountId="owner" />));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Add phone")!.click());
  expect(host.textContent).toContain("cannot be paired"); expect(host.querySelector('[data-testid="qr"]')).toBeNull();
  expect(host.textContent).not.toContain(mock.url); expect(host.textContent).not.toContain("Copy link");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "How to install")!.click());
  expect(host.textContent).toContain("First give this server an HTTPS address");
  expect(host.textContent).not.toContain(mock.url); expect(host.textContent).not.toContain("Install guide");
});
