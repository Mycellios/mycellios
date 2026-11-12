// @vitest-environment jsdom
import type { DesktopUpdateState } from "@rakazo/contracts";
import { Toaster } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdatesProvider } from "./DesktopUpdates";
import { SidebarFooter, sidebarMarkCount } from "./SidebarFooter";

// Exercise the sidebar fallback while unsaved work delays the full-window gate.
vi.mock("../lib/desktop-update-work", () => ({
  canRestartDesktop: () => false, canShowDesktopUpdate: () => false, desktopUpdateHasCall: () => false,
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.rakazoDesktop;
  vi.restoreAllMocks();
});
async function render(
  name = "Demo User",
  image?: string,
  onIntegrations = vi.fn(),
  onBoard?: () => void,
  logos?: Array<{ name: string; logo?: string }>,
  rail = false,
) {
  const email = "account@rakazo.test";
  await act(async () =>
    root.render(
      <DesktopUpdatesProvider>
        <SidebarFooter
          logos={logos}
          rail={rail}
          name={name}
          initials={name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
          image={image}
          email={email}
          open
          onOpenChange={() => {}}
          onIntegrations={onIntegrations}
          onBoard={onBoard}
          onArtifacts={() => {}}
          onSettings={() => {}}
          onUsage={() => {}}
          onLogOut={() => {}}
          signingOut={false}
          logOutError={null}
        />
        <Toaster />
      </DesktopUpdatesProvider>,
    ),
  );
}
function bridge(phase: DesktopUpdateState["phase"], percent: number | null = null) {
  const state: DesktopUpdateState = {
    phase,
    currentVersion: "0.1.0",
    availableVersion: "0.2.0",
    percent,
    message: null,
    checkedAt: null,
  };
  const install = vi.fn(async () => state);
  window.rakazoDesktop = {
    platform: "darwin",
    window: {
      close: async () => {},
      minimize: async () => {},
      toggleMaximize: async () => {},
      state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
    },
    oauth: { onCallback: () => () => {} },
    update: {
      state: async () => state,
      install,
      download: async () => state,
      check: async () => state,
    },
  };
  return install;
}
it("hides update controls without a desktop bridge", async () => {
  await render();
  expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
});
it.each(["unsupported", "idle", "available", "downloading", "checking", "error"] as const)(
  "hides install controls in phase %s",
  async (phase) => {
    bridge(phase);
    await render();
    expect(document.querySelector('[aria-label="Install update"]')).toBeNull();
    if (["available", "downloading", "checking"].includes(phase)) {
      expect(host.querySelector(".myc-update-notice")).not.toBeNull();
      expect(document.body.textContent).toContain("New update available");
    }
  },
);
it("installs the ready update only through the footer button", async () => {
  const install = bridge("ready");
  await render("Ada Lovelace");
  const icon = document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!;
  expect(icon).not.toBeNull();
  expect(document.body.textContent).not.toContain("New update available");
  await act(async () => icon.click());
  expect(install).toHaveBeenCalledTimes(1);
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "Install"),
  ).toBe(false);
});
it("shows real native download progress and never installs while downloading", async () => {
  const install = bridge("downloading", 43.6);
  await render();
  expect(host.querySelector("progress")?.value).toBe(44);
  expect(host.textContent).toContain("44%");
  expect(host.querySelector('[aria-label="Install update"]')).toBeNull();
  expect(install).not.toHaveBeenCalled();
});
it("does not invent a percentage when download progress is unknown", async () => {
  bridge("downloading");
  await render();
  expect(host.textContent).toContain("Downloading…");
  expect(host.querySelector("progress")?.hasAttribute("value")).toBe(false);
});
it("shows the account image and falls back to the initial after a load error", async () => {
  await render("Ada Lovelace", "https://example.test/avatar.png");
  const trigger = host.querySelector('[data-testid="user-menu-trigger"]')!;
  const image = trigger.querySelector("img")!;
  expect(image.src).toBe("https://example.test/avatar.png");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(trigger.querySelector("img")).toBeNull();
  expect(trigger.textContent).toBe("AL");
});

it("opens integrations and keeps the existing account actions and links", async () => {
  const onIntegrations = vi.fn();
  await render("Demo User", undefined, onIntegrations, vi.fn());
  const connect = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => connect.click());
  expect(onIntegrations).toHaveBeenCalledOnce();
  const menu = document.querySelector('[data-slot="popover-content"]')!;
  expect([...menu.querySelectorAll("button, a")].map((row) => row.textContent)).toEqual([
    "Usage",
    "Board",
    "Library",
    "Settings",
    "Mycellios on your phone",
    "Get Mycellios Desktop",
    "What's new",
    "Log out",
  ]);
  expect(host.querySelector('[data-testid="user-menu-trigger"]')?.getAttribute("aria-label")).toBe(
    "Account menu for Demo User",
  );
});
it("omits Board when unavailable", async () => {
  await render();
  expect(document.querySelector('[data-slot="popover-content"]')?.textContent).not.toContain(
    "Board",
  );
});

it("does not advertise an upstream Android installer as a branded release", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
  await render();
  expect(
    [...document.querySelectorAll("a")].some((link) => link.textContent === "Get the mobile app"),
  ).toBe(false);
});

it("falls back when app artwork fails and accepts replacement artwork", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/slack.svg" },
  ]);
  const pill = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Connect apps"),
  )!;
  await act(async () => pill.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(pill.querySelector("img")).toBeNull();
  expect(pill.textContent).toContain("S");
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Slack", logo: "https://example.test/new-slack.svg" },
  ]);
  expect(pill.querySelector("img")?.src).toBe("https://example.test/new-slack.svg");
});

it("shows the app marks in a single rail shortcut beside the account control", async () => {
  const onIntegrations = vi.fn();
  const logos = ["Gmail", "GitHub", "Calendar"].map((name) => ({
    name,
    logo: `https://example.test/${name}.svg`,
  }));
  await render("Demo User", undefined, onIntegrations, undefined, logos, true);
  const shortcut = host.querySelector<HTMLButtonElement>('[aria-label="Connect apps"]')!;
  expect([...shortcut.querySelectorAll("img")].map((image) => image.src)).toEqual(logos.map((mark) => mark.logo));
  expect(host.querySelector('[data-testid="user-menu-trigger"]')).not.toBeNull();
  await act(async () => shortcut.click());
  expect(onIntegrations).toHaveBeenCalledOnce();
});
it.each(["throw", "state"] as const)(
  "shows a %s install failure while unsaved work delays the update screen",
  async (failure) => {
    const install = bridge("ready");
    if (failure === "throw") install.mockRejectedValueOnce(new Error("offline"));
    else
      install.mockResolvedValueOnce({
        ...(await window.rakazoDesktop!.update.state()),
        phase: "error",
        message: "Update could not be installed",
      });
    await render();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Install update"]')!.click(),
    );
    await vi.waitFor(() =>
      expect(host.textContent).toContain(
        failure === "throw"
          ? "Could not complete the update. Try again."
          : "Update could not be installed",
      ),
    );
  },
);

it.each([
  [-20, 0],
  [0, 0],
  [25, 0],
  [26, 1],
  [47, 1],
  [48, 2],
  [69, 2],
  [70, 3],
  [200, 3],
])("fits marks into %ipx without consuming label or padding space", (width, count) => {
  expect(sidebarMarkCount(width)).toBe(count);
});

it("keeps at most three marks with the same tile and a missing-logo fallback", async () => {
  await render("Demo User", undefined, undefined, undefined, [
    { name: "Gmail", logo: "https://example.test/gmail.svg" },
    { name: "Notion" },
    { name: "GitHub", logo: "https://example.test/github.svg" },
    { name: "Slack" },
  ]);
  const tiles = [...host.querySelectorAll('span[aria-hidden="true"] > span')];
  expect(tiles).toHaveLength(3);
  expect(new Set(tiles.map((tile) => tile.className)).size).toBe(1);
  expect(tiles[1]!.textContent).toBe("N");
});
