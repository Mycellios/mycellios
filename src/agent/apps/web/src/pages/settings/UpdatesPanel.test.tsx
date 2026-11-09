// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ desktop: false, build: "20261029170000" }));

vi.mock("../../lib/desktop", () => ({
  desktopBridge: () => (state.desktop ? { update: {} } : null),
}));
vi.mock("../../lib/client-build", () => ({ CLIENT_BUILD: state.build }));
vi.mock("../../lib/client-update", () => ({
  clientUpdates: () => ({
    getSnapshot: () => null,
    subscribe: () => () => {},
    checkForUpdates: vi.fn(async () => state.build),
  }),
}));
vi.mock("../../components/DesktopUpdates", () => ({
  DesktopUpdateSection: () => <section>Desktop app</section>,
}));
vi.mock("../../components/SettingsRows", () => ({
  SettingsGroup: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section><h2>{title}</h2>{children}</section>
  ),
  SettingsRow: ({ label, control, children }: { label: string; control: React.ReactNode; children?: React.ReactNode }) => (
    <div><span>{label}</span>{control}{children}</div>
  ),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
}));

import { UpdatesPanel } from "./UpdatesPanel";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.desktop = false;
  state.build = "20261029170000";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(<UpdatesPanel onClose={() => {}} />);
  });
}

it("shows one app version on Desktop and keeps the bundled web build in technical details", async () => {
  state.desktop = true;
  await render();
  expect(host.textContent).toContain("Desktop app");
  expect(host.textContent).not.toContain("Web version");
  expect(host.textContent).not.toContain("Check web updates");
  expect(host.textContent).toContain("Technical details");
  expect(host.textContent).toContain("20261029170000");
});

it("shows the web version and its check outside Desktop", async () => {
  await render();
  expect(host.textContent).toContain("Web version");
  expect(host.textContent).toContain("Check web updates");
  expect(host.textContent).not.toContain("Desktop app");
});
