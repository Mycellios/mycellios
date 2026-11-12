// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { Bot } from "@rakazo/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { AppCover } from "./AppCover";

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), open: vi.fn(), send: vi.fn(), status: vi.fn(), list: vi.fn(), image: vi.fn() }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
const client = { appCovers: { get: api.get, set: api.set }, development: { open: api.open, status: api.status },
  threads: { send: api.send }, artifacts: { list: api.list, getById: api.image } };
vi.mock("../../components/VideoStudioSample", () => ({ VideoStudioSample: () => <span>Original preview</span> }));
vi.mock("@lingui/react/macro", () => ({ Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
it("uses the chosen Mico and app context, then waits for explicit apply before saving its result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  const artifact = { id: "generated-image", botId: "mico-two", groupId: null, runId: "generated-run", name: "generated.png",
    description: null, mimeType: "image/png", size: 70, version: 1, createdAt: new Date().toISOString(), contentBase64: png };
  api.get.mockResolvedValue({ revision: null, image: null });
  api.set.mockResolvedValue({ revision: "saved-cover", image: artifact });
  api.open.mockResolvedValue({ threadId: "cover-task" }); api.send.mockResolvedValue({ runId: "generated-run" });
  api.status.mockResolvedValue({ status: "completed", detail: "", error: null });
  api.list.mockResolvedValue([artifact]); api.image.mockResolvedValue(artifact);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter><AppCover app={{ id: "video-studio", title: "Estudio de vídeos", description: "Vídeo con voz" }}
    bots={[{ id: "mico-one", name: "Primero" }, { id: "mico-two", name: "Diseño" }] as Bot[]}
    activeBotId="mico-one" scope="owner:space" /></MemoryRouter>));
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label)!;
  await act(async () => button("Personalizar carátula de Estudio de vídeos").click());
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Mico para la carátula"]')!;
  await act(async () => { select.value = "mico-two"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("Generar con un Mico").click());
  const style = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Estilo de la carátula"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(style, "Terciopelo verde"); style.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Generar carátula").click());
  expect(api.send).toHaveBeenCalledOnce();
  expect(api.send).toHaveBeenCalledWith(expect.objectContaining({ botId: "mico-two", taskThreadId: "cover-task",
    text: expect.stringContaining("Terciopelo verde") }));
  expect(api.send.mock.calls[0]?.[0].text).toContain('"id":"video-studio"');
  expect(api.set).not.toHaveBeenCalled();
  expect(button("Aplicar carátula").disabled).toBe(false);
  await act(async () => button("Aplicar carátula").click());
  expect(api.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ appId: "video-studio", botId: "mico-two", expectedRevision: null,
    source: { kind: "artifact", artifactId: "generated-image" } }));
});
