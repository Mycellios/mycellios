// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ i18n: { locale: "es" }, t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), "") }) }));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant: _variant, size: _size, ...p }: React.ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...p} />,
  Label: (p: React.ComponentProps<"label">) => <label {...p} />,
  Switch: () => <span />,
  OptionSelect: ({ value, options, onValueChange, ...p }: { value: string; options: { value: string; label: string }[]; onValueChange: (v: string) => void }) => <select {...p} value={value} onChange={e => onValueChange(e.target.value)}>{options.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}</select>,
}));
const nativeMock = vi.hoisted(() => ({ bridge: undefined as any }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => nativeMock.bridge }));
const speech = vi.hoisted(() => ({ state: { messageId: "" }, speak: vi.fn(), stop: vi.fn() }));
vi.mock("../../lib/tts", () => ({ speaker: speech, browserSpeechAvailable: () => true }));
import { setGeneralPreferences } from "../../lib/general-preferences";
import { DeviceVoiceSettings } from "./DeviceVoiceSettings";
let cleanup: () => Promise<void>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); nativeMock.bridge = undefined;
  speech.speak.mockReset(); speech.stop.mockReset();
  setGeneralPreferences({ networkSpeechAccount: "owner", dictationLanguage: "es" });
});
afterEach(async () => { await cleanup?.(); vi.unstubAllGlobals(); });
async function mount(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  cleanup = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node));
  return { div, rerender: async (next: ReactNode) => { await act(async () => root.render(next)); } };
}
const preview = <DeviceVoiceSettings accountId="owner" previewBotId="mico" spaceId="space" />;
it("stops its pending preview and ignores its late error after switching away from the network", async () => {
  let settle: (value?: string) => void = () => {};
  speech.speak.mockImplementation((_text, options) => { speech.state.messageId = options.messageId; return new Promise(resolve => { settle = resolve; }); });
  const { div } = await mount(preview);
  await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Listen")!.click());
  expect(speech.speak).toHaveBeenCalledOnce();
  const select = div.querySelector<HTMLSelectElement>('select[aria-label="Voice conversation output"]')!;
  await act(async () => { select.value = "provider"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(speech.stop).toHaveBeenCalledOnce();
  await act(async () => settle("Late account error"));
  expect(div.textContent).not.toContain("Late account error");
});
it("clears preview state and ignores old-account results when the scope changes", async () => {
  let settle: (value?: string) => void = () => {};
  speech.speak.mockImplementation((_text, options) => { speech.state.messageId = options.messageId; return new Promise(resolve => { settle = resolve; }); });
  const { div, rerender } = await mount(preview);
  await act(async () => [...div.querySelectorAll("button")].find(b => b.textContent === "Listen")!.click());
  await rerender(<DeviceVoiceSettings accountId="another-owner" previewBotId="other-mico" spaceId="other-space" />);
  await act(async () => settle("Previous account error"));
  expect(speech.stop).toHaveBeenCalledOnce();
  expect(div.textContent).not.toMatch(/Previous account error|Stop/);
});

it("previews installed device voices without selecting a paid network route", async () => {
  setGeneralPreferences({ networkSpeechAccount: "", speechEngine: "device" });
  vi.stubGlobal("speechSynthesis", { getVoices: () => [{ voiceURI: "local-es", name: "Español", lang: "es-ES", localService: true }], addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { div } = await mount(preview);
  await act(async () => [...div.querySelectorAll("button")].find(button => button.textContent === "Listen")!.click());
  expect(speech.speak).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ browser: true, networkLanguage: undefined }));
});
it("locks the language hint to automatic for active Parakeet without overwriting a saved provider language", async () => {
  nativeMock.bridge = { localVoice: { status: async () => ({ ready: true, models: { asr: { ready: true }, tts: { ready: true } } }), prepareModel: vi.fn() } };
  setGeneralPreferences({ networkTranscriptionAccount: "", dictationEngine: "local", dictationLanguage: "fr" });
  const { div } = await mount(preview);
  const language = div.querySelector<HTMLSelectElement>('select[aria-label="Dictation language"]')!;
  expect(language.disabled).toBe(true); expect(language.value).toBe("auto");
  expect(JSON.parse(localStorage.getItem("mycellios.general.v1")!).dictationLanguage).toBe("fr");
});
