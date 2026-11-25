// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
vi.mock("../../lib/desktop", () => ({ desktopDragClass: () => "" }));
import { routinesAvailable } from "../../lib/routines-availability";
import { RoutinesAvailability } from "./RoutinesAvailability";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
// Start paused so the Coming soon path stays covered; default cases clear the flag.
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubEnv("VITE_MYCELLIOS_ROUTINES", "false"); });
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function mount(children: ReactNode, onExit = vi.fn(), onNavigation = vi.fn()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(() => root!.render(<RoutinesAvailability onExit={onExit} onNavigation={onNavigation}>{children}</RoutinesAvailability>));
}

it.each([undefined, "", "true", "1", "TRUE"])("opens routines unless an operator pauses them (%s)", value => {
  vi.stubEnv("VITE_MYCELLIOS_ROUTINES", value);
  expect(routinesAvailable()).toBe(true);
});
it("keeps the operator's explicit pause without touching saved routines", () => {
  vi.stubEnv("VITE_MYCELLIOS_ROUTINES", "false");
  expect(routinesAvailable()).toBe(false);
});
it("blocks a direct routine/editor link while paused, before rendering queries or actions", async () => {
  const load = vi.fn(() => <button>Run routine</button>);
  const Loaded = load;
  await mount(<Loaded />);
  expect(load).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Routines");
  expect(host.textContent).toContain("Coming soon");
  expect(host.textContent).not.toContain("Run routine");
});
it("keeps back-to-chat and mobile navigation usable while paused, without executing a routine", async () => {
  const exit = vi.fn(), navigate = vi.fn();
  await mount(<p>Private editor</p>, exit, navigate);
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!.click());
  await act(() => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Back to chat")!.click());
  expect(exit).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledOnce();
});
it("mounts the saved routine editor by default", async () => {
  vi.stubEnv("VITE_MYCELLIOS_ROUTINES", undefined);
  await mount(<textarea defaultValue="Saved routine" />);
  expect(routinesAvailable()).toBe(true);
  expect(host.querySelector("textarea")?.value).toBe("Saved routine");
  expect(host.querySelector('[data-testid="routines-coming-soon"]')).toBeNull();
});
