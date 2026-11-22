// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MicoPcFolder } from "./MicoPcFolder";

const { bridge } = vi.hoisted(() => ({
  bridge: { value: undefined as undefined | { computer: Record<string, unknown> } },
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => bridge.value }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: string }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const micoFolder = vi.fn();
const openMicoFolder = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  bridge.value = { computer: { micoFolder, openMicoFolder } };
  micoFolder.mockResolvedValue("C:\\Users\\someone\\Mycellios\\Micos\\Writer");
  openMicoFolder.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(<MicoPcFolder botId="mico" />));

it("shows the folder read-only and opens it through Desktop by Mico id", async () => {
  await render();
  expect(micoFolder).toHaveBeenCalledWith("mico");
  expect(host.querySelector("code")?.textContent).toBe(
    "C:\\Users\\someone\\Mycellios\\Micos\\Writer",
  );
  expect(host.querySelector("input")).toBeNull();
  await act(() => host.querySelector("button")!.click());
  expect(openMicoFolder).toHaveBeenCalledWith("mico");
});

it("stays hidden on the web and before the folder exists", async () => {
  bridge.value = undefined;
  await render();
  expect(host.textContent).toBe("");
  bridge.value = { computer: { micoFolder, openMicoFolder } };
  micoFolder.mockResolvedValue(null);
  await act(() => root.render(<MicoPcFolder botId="other" />));
  expect(host.textContent).toBe("");
});

it("reports a folder that could not be opened", async () => {
  openMicoFolder.mockRejectedValue(new Error("refused"));
  await render();
  await act(() => host.querySelector("button")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Could not continue");
});
