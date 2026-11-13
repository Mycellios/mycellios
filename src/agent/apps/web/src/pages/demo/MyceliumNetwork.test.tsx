// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ BotAvatar: () => <span />, Button: (props: any) => <button {...props} /> }));
import { MyceliumNetwork } from "./MyceliumNetwork";
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, onScreen = true;
const guest = { number: 1, kind: "mobile", present: true, connected: true, working: false, earnedMicrounits: 0, inferences: 0 };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); onScreen = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: onScreen ? 100 : 2000, left: 0, bottom: onScreen ? 600 : 2500, right: 800, width: 800, height: 500, x: 0, y: 100, toJSON: () => ({}) }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const motion = () => host.querySelector(".mycelium-scene")?.getAttribute("data-motion");
it("can resume after viewport changes but cannot animate an offscreen or hidden scene", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => root.render(<MyceliumNetwork devices={[guest]} />)); expect(motion()).toBe("running");
  await act(async () => host.querySelector("button")!.click()); expect(motion()).toBe("paused");
  onScreen = false; await act(async () => window.dispatchEvent(new Event("resize")));
  await act(async () => host.querySelector("button")!.click()); expect(motion()).toBe("paused");
  onScreen = true; await act(async () => window.dispatchEvent(new Event("resize"))); expect(motion()).toBe("running");
  visibility.mockReturnValue("hidden"); await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(motion()).toBe("paused");
  visibility.mockReturnValue("visible"); await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(motion()).toBe("running");
});
it("distinguishes idle availability from actual inference traffic and retains the same peer element", async () => {
  await act(async () => root.render(<MyceliumNetwork devices={[guest, { ...guest, number: 2 }]} />));
  const peer = host.querySelector(".mycelium-peer");
  expect(host.querySelectorAll(".mycelium-work")).toHaveLength(0);
  await act(async () => root.render(<MyceliumNetwork devices={[{ ...guest, working: true }, { ...guest, number: 2 }]} />));
  expect(host.querySelector(".mycelium-peer")).toBe(peer); expect(host.querySelectorAll(".mycelium-work")).toHaveLength(1);
  await act(async () => root.render(<MyceliumNetwork devices={[guest, { ...guest, number: 2 }]} />));
  expect(host.querySelectorAll(".mycelium-work")).toHaveLength(0);
});
