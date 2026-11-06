// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";

const audio = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn(), speak: vi.fn(), silence: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""), i18n: { locale: "es" } }) }));
vi.mock("@rakazo/ui-web", () => ({ BotAvatar: () => <span />, Button: ({ variant: _v, size: _s, ...props }: any) => <button {...props} /> }));
vi.mock("../../lib/dictation", () => ({ webSpeechAvailable: () => true, dictation: { listen: audio.listen, stop: audio.stop, subscribe: () => () => {} } }));
vi.mock("../../lib/tts", () => ({ browserSpeechAvailable: () => true, speaker: { speak: audio.speak, stop: audio.silence, subscribe: () => () => {} } }));
vi.mock("../../lib/call-session", () => ({ endCall: vi.fn() }));
import { VoiceConversation } from "./VoiceConversation";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("listens, sends and reads the exact owned task conversation without redirecting to the main chat", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const get = vi.fn().mockResolvedValue({ messages: [] });
  const send = vi.fn(async (_input: unknown, _options?: unknown) => {
    get.mockResolvedValue({ messages: [{ id: "reply", role: "bot", blocks: [{ kind: "text", text: "Listo." }] }], activeRuns: [] });
  });
  const client = { threads: { get, send } } as unknown as RpcClient;
  const close = vi.fn();
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<VoiceConversation rpc={client} spaceId="owned-space" taskThreadId="private-task" bot={{ id: "mico", name: "Mico", color: "#9B5CF6" }} onClose={close} onSettings={() => {}} transcribe />));
  expect(audio.listen).toHaveBeenCalledOnce();
  expect(audio.listen.mock.calls[0]![0]).toMatchObject({ spaceId: "owned-space" });
  const turn = audio.listen.mock.calls[0]![0] as { onFinal: (text: string) => void };
  await act(async () => { turn.onFinal("Hola"); });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0]).toMatchObject({ botId: "mico", taskThreadId: "private-task", text: "Hola", clientNonce: expect.any(String) });
  expect(get.mock.calls.every(call => call[0].taskThreadId === "private-task")).toBe(true);
  expect(audio.speak).toHaveBeenCalledWith("Listo.", expect.objectContaining({ botId: "mico" }));
  await act(async () => root!.unmount()); root = undefined;
  expect(audio.stop).toHaveBeenCalledWith("cancel");
  expect(audio.silence).toHaveBeenCalled();
});
