// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
vi.mock("../../lib/desktop", () => ({ desktopDragClass: () => "" }));
import { workflowsAvailable } from "../../lib/workflows-availability";
import { WorkflowsAvailability } from "./WorkflowsAvailability";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubEnv("VITE_MYCELLIOS_WORKFLOWS", "false"); });
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function mount(children: ReactNode, onExit = vi.fn(), onNavigation = vi.fn()) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(() => root!.render(<WorkflowsAvailability onExit={onExit} onNavigation={onNavigation}>{children}</WorkflowsAvailability>));
}

it.each([undefined, "", "false", "1", "TRUE"])("keeps workflows paused without explicit enablement (%s)", value => {
  vi.stubEnv("VITE_MYCELLIOS_WORKFLOWS", value);
  expect(workflowsAvailable()).toBe(false);
});
it("blocks a direct workflow/editor link before rendering queries or actions", async () => {
  const load = vi.fn(() => <button>Run workflow</button>);
  const Loaded = load;
  await mount(<Loaded />);
  expect(load).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.textContent).toBe("Workflows");
  expect(host.textContent).toContain("Coming soon");
  expect(host.textContent).not.toContain("Run workflow");
});
it("keeps back-to-chat and mobile navigation usable without executing a workflow", async () => {
  const exit = vi.fn(), navigate = vi.fn();
  await mount(<p>Private editor</p>, exit, navigate);
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!.click());
  await act(() => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Back to chat")!.click());
  expect(exit).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledOnce();
});
it("preserves the existing editor behind explicit reactivation", async () => {
  vi.stubEnv("VITE_MYCELLIOS_WORKFLOWS", "true");
  await mount(<textarea defaultValue="Saved workflow" />);
  expect(workflowsAvailable()).toBe(true);
  expect(host.querySelector("textarea")?.value).toBe("Saved workflow");
  expect(host.querySelector('[data-testid="workflows-coming-soon"]')).toBeNull();
});
