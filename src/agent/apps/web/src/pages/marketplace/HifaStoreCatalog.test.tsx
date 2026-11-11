// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant,
    size,
    ...props
  }: {
    variant?: string;
    size?: string;
    children?: ReactNode;
  }) => <button {...props} />,
  Input: (props: object) => <input {...props} />,
}));
vi.mock("../cadencia/Cadencia", () => ({
  default: ({ onBack, scope }: { onBack: () => void; scope: string }) => (
    <div>
      Editor {scope}
      <button onClick={onBack}>Hifa Store</button>
    </div>
  ),
}));
import { HifaStoreCatalog } from "./HifaStoreCatalog";
afterEach(() => {
  vi.unstubAllGlobals();
});
function Location() {
  return <output>{useLocation().search}</output>;
}
it("opens browser Cadencia without any Desktop capability and returns to the same Store URL", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/app/mico?view=marketplace&market=mycellios-apps"]}>
          <HifaStoreCatalog scope="account-space" />
          <Location />
        </MemoryRouter>,
      ),
    );
    expect(host.textContent).toContain("Cadencia");
    expect(host.textContent).not.toContain("Estudio de vídeos");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Abrir Cadencia"]')!.click(),
    );
    expect(host.textContent).toContain("Editor account-space");
    expect(host.querySelector("output")!.textContent).toContain("app=cadencia");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Hifa Store")!
        .click(),
    );
    expect(host.querySelector("output")!.textContent).toBe(
      "?view=marketplace&market=mycellios-apps",
    );
    expect(host.textContent).toContain("Recorta silencios");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("preserves the native Video Studio launcher when its capability is available", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const open = vi.fn(),
    host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <HifaStoreCatalog scope="account-space" onOpenStudio={open} />
        </MemoryRouter>,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Abrir Estudio de vídeos"]')!.click(),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Desktop · Windows");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
