// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const resetBrowser = vi.hoisted(() => vi.fn());
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => ({ bots: { resetBrowser } }) }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((s, part, i) => `${s}${i ? values[i - 1] : ""}${part}`, "") }),
}));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant: _, size: __, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
import { BotBrowserReset } from "./BotBrowserReset";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetBrowser.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const render = () => act(async () => root.render(<BotBrowserReset botId="bot-1" />));

it("asks before closing the sessions and confirms when done", async () => {
  resetBrowser.mockResolvedValue({ ok: true, computerOff: false });
  await render();
  await click("Close browser sessions");
  expect(resetBrowser).not.toHaveBeenCalled();
  expect(container.querySelector("[role=dialog]")).not.toBeNull();
  await click("Close sessions");
  expect(resetBrowser).toHaveBeenCalledWith({ botId: "bot-1" });
  expect(container.querySelector("[role=dialog]")).toBeNull();
  expect(container.textContent).toContain("The Mico is signed out of every website.");
});

it("explains a sleeping computer and a working Mico", async () => {
  resetBrowser.mockResolvedValueOnce({ ok: true, computerOff: true });
  await render();
  await click("Close browser sessions");
  await click("Close sessions");
  expect(container.textContent).toContain("Its computer is off");

  resetBrowser.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "CONFLICT" }));
  await click("Close browser sessions");
  await click("Close sessions");
  expect(container.querySelector("[role=dialog]")).not.toBeNull();
  expect(container.querySelector("[role=alert]")?.textContent).toBe("The Mico is working. Try again when it finishes.");
});
