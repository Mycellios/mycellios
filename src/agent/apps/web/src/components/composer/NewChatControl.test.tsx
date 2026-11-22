// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ Trans: ({ children }: {children: ReactNode}) => children, useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "") }) }));
const api = vi.hoisted(() => ({ newChat: vi.fn(), compactContext: vi.fn(), scope: vi.fn() }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => ({ threads: api }), useBoundTaskThreadScope: api.scope }));
import { NewChatControl } from "./NewChatControl";
let root: Root, container: HTMLDivElement;
const started=vi.fn();
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); i18n.load("en",{}); i18n.activate("en"); api.newChat.mockReset().mockResolvedValue({ok:true}); api.scope.mockReset().mockReturnValue(undefined); started.mockClear(); container=document.createElement("div"); document.body.append(container); root=createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function button(label:string) { return [...document.querySelectorAll<HTMLButtonElement>('button,[role="menuitem"]')].find(b => b.textContent===label || b.getAttribute('aria-label')===label)!; }
async function open(disabled=false) { await act(async () => root.render(<NewChatControl botId="bot" name="Ada" disabled={disabled} onStarted={started}/>)); await act(async () => button("Conversation options").click()); if(!disabled) await act(async () => button("Reset context…").click()); }
it("asks for confirmation and Cancel does not reset or remove chat", async () => {
 await open(); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Reset Ada's main chat context?");
 expect(document.body.textContent).toContain("To work on another task, choose New conversation"); expect(api.newChat).not.toHaveBeenCalled();
 await act(async () => button("Cancel").click()); expect(api.newChat).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled();
});
it("starts once on confirmation and keeps the same nonce when a request fails", async () => {
 api.newChat.mockRejectedValueOnce(new Error("Try again")); await open();
 await act(async () => button("Reset context").click()); expect(document.querySelector('[role="alert"]')).not.toBeNull();
 expect(started).not.toHaveBeenCalled(); const request=api.newChat.mock.calls[0]![0];
 await act(async () => button("Reset context").click()); expect(api.newChat.mock.calls[1]![0]).toEqual(request);
 expect(request).toEqual({botId:"bot",clientNonce:expect.any(String)}); expect(started).toHaveBeenCalledOnce();
});
it("does not offer to reset an active or unavailable composer", async () => {
 await open(true); expect(button("Conversation options").disabled).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("never resets the main chat from an independent task conversation", async () => {
 api.scope.mockReturnValue({ taskThreadId: "kuma-task" });
 await act(async () => root.render(<NewChatControl botId="bot" name="Ada" onStarted={started}/>));
 expect(container.querySelector('button')).toBeNull(); expect(api.newChat).not.toHaveBeenCalled();
});
it("requires confirmation and compacts only the selected conversation", async () => {
  api.scope.mockReturnValue({ botId: "bot", taskThreadId: "task-1" });
  api.compactContext.mockResolvedValue({ queued: true });
  await act(async () => root.render(<NewChatControl botId="bot" name="Ada" canCompact />));
  await act(async () => button("Conversation options").click());
  expect(button("Reset context…")).toBeUndefined();
  await act(async () => button("Compact now…").click());
  expect(api.compactContext).not.toHaveBeenCalled();
  await act(async () => button("Compact now").click());
  expect(api.compactContext).toHaveBeenCalledExactlyOnceWith({ botId: "bot", taskThreadId: "task-1" });
  expect(api.newChat).not.toHaveBeenCalled();
});
