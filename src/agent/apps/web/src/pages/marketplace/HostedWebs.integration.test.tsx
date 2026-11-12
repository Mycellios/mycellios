// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../lib/rpc", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/rpc")>()),
  selectedSpaceId: () => "space", createSpaceRpc: () => ({ webs: api }),
}));
vi.mock("./HostedWebEditor", () => ({ WebEditor: () => null }));
vi.mock("./AppCover", () => ({ AppCover: ({ fallback }: { fallback?: ReactNode }) => <>{fallback}</> }));
vi.mock("../cadencia/Cadencia", () => ({ default: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>Volver de Cadencia</button> }));
vi.mock("./VideoEditor", () => ({ VideoEditor: ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>Volver del editor</button> }));
vi.mock("./MycelliosCreate", () => ({ MycelliosCreate: () => <p>Creación multimedia</p> }));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant: _v, size: _s, ...props }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
import { HostedWebs } from "./HostedWebs";

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.unstubAllGlobals(); });
function Location() { return <output>{useLocation().search}</output>; }
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={["/app/mico?view=marketplace&market=mycellios-apps"]}>
      <HostedWebs scope='["owner","space"]' spaceId="space" bots={[]} onOpenBot={() => {}} onCreateBot={() => {}} />
      <Location />
    </MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}
const button = (name: string) => Array.from(host.querySelectorAll("button")).find(node => node.getAttribute("aria-label") === name || node.textContent === name)!;

it("retains browser Cadencia, Desktop editors and community apps in one directory", async () => {
  api.list.mockResolvedValue([{ id: "site", title: "Antseed Radar", slug: "antseed", published: true, owned: false, pinned: false, views: 1 }]);
  await mount();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(host.textContent).toContain("Cadencia"); expect(host.textContent).toContain("Editar vídeo");
  expect(host.textContent).toContain("Estudio de vídeos"); expect(host.textContent).toContain("Antseed");
  await act(async () => button("Abrir Cadencia").click());
  expect(host.querySelector("output")?.textContent).toContain("app=cadencia");
  await act(async () => button("Volver de Cadencia").click());
  await act(async () => button("Ver Editar vídeo").click());
  expect(host.querySelector("output")?.textContent).toContain("app=video-edit");
  await act(async () => button("Volver del editor").click());
  expect(host.textContent).toContain("Cadencia");
});

it("keeps first-party tools usable when the community directory fails", async () => {
  api.list.mockRejectedValue(new Error("Directory unavailable"));
  await mount();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("Abrir Cadencia")).toBeDefined(); expect(button("Ver Editar vídeo")).toBeDefined();
});
