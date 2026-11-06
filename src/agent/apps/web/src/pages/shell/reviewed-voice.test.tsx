// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dictation, type DictationSnapshot } from "../../lib/dictation";
import { useReviewedVoice } from "./reviewed-voice";

vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
const watchers = new Set<(s: DictationSnapshot) => void>();
let final: (s: string) => void;
let words = "";
vi.mock("../../lib/dictation", () => ({ dictation: {
  subscribe: vi.fn((cb: (s: DictationSnapshot) => void) => { watchers.add(cb); return () => watchers.delete(cb); }),
  listen: vi.fn(async (opts: { onFinal: (s: string) => void }) => { final = opts.onFinal; }),
  stop: vi.fn(),
  submitHold: vi.fn(() => { watchers.forEach(cb => cb({ status: "idle", transcript: "" })); final(words); }),
} }));
let voice: ReturnType<typeof useReviewedVoice>;
let root: Root;
let node: HTMLDivElement;
const send = vi.fn(async (_text: string, _nonce: string) => true);
function Harness({ scope = "mico-a", blocked = false }) {
  voice = useReviewedVoice({ scope, blocked, transcribe: false, onSend: send });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  send.mockResolvedValue(true); words = "first idea";
  node = document.createElement("div"); root = createRoot(node);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); watchers.clear(); vi.unstubAllGlobals(); });
it("reviews, edits and appends another recording before explicit send", async () => {
  act(() => voice.start()); act(() => voice.stop());
  expect(voice.stage).toBe("review"); expect(send).not.toHaveBeenCalled();
  act(() => voice.edit("edited idea"));
  words = "and another"; act(() => voice.start()); act(() => voice.stop());
  expect(voice.text).toBe("edited idea and another");
  await act(async () => voice.send());
  expect(send).toHaveBeenCalledExactlyOnceWith("edited idea and another", expect.any(String));
  expect(voice.stage).toBe("closed");
});
it("ignores a cancelled recording's delayed completion", () => {
  act(() => voice.start()); const late = final;
  act(() => voice.cancel()); act(() => late("must not send"));
  expect(voice.stage).toBe("closed"); expect(voice.text).toBe(""); expect(send).not.toHaveBeenCalled();
});
it("keeps refused sends and reuses their nonce", async () => {
  send.mockResolvedValue(false); act(() => voice.start()); act(() => voice.stop());
  await act(async () => voice.send());
  const nonce = send.mock.calls[0]?.[1];
  expect(voice.stage).toBe("review"); expect(voice.text).toBe(words);
  send.mockResolvedValue(true); await act(async () => voice.send());
  expect(send.mock.calls[1]?.[1]).toBe(nonce);
});
it("cannot move recorded words into another Mico", () => {
  act(() => voice.start()); const late = final;
  act(() => root.render(<Harness scope="mico-b" />));
  act(() => late("old Mico's words"));
  expect(voice.stage).toBe("closed"); expect(send).not.toHaveBeenCalled();
});
it("does not send while stopping or when blocked", async () => {
  vi.mocked(dictation.submitHold).mockImplementationOnce(() => {});
  act(() => voice.start()); act(() => voice.stop());
  await act(async () => voice.send()); expect(send).not.toHaveBeenCalled();
  act(() => final(words)); act(() => root.render(<Harness blocked />));
  await act(async () => voice.send()); expect(send).not.toHaveBeenCalled();
});
