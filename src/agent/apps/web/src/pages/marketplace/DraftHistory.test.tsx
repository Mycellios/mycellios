// @vitest-environment jsdom
import type { HostedWebDraft, HostedWebSnapshot } from "@rakazo/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@rakazo/ui-web", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Disclosure: ({
    summary,
    children,
    onOpenChange,
  }: {
    summary: ReactNode;
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <section>
      <button type="button" onClick={() => onOpenChange(true)}>
        {summary}
      </button>
      {children}
    </section>
  ),
}));

import { DraftHistory } from "./DraftHistory";

const draft: HostedWebDraft = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "app",
  title: "App",
  summary: "",
  version: 3,
  published: true,
  bundle: { files: [{ path: "index.html", base64: btoa("v3") }] },
};
const row = (
  version: number,
  source: HostedWebSnapshot["source"],
  current = false,
): HostedWebSnapshot => ({
  id: `00000000-0000-4000-8000-00000000000${version}`,
  version,
  source,
  title: `App v${version}`,
  createdAt: "2026-11-18T12:00:00.000Z",
  bytes: 2048,
  current,
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(dirty: boolean) {
  const history = {
    list: vi.fn().mockResolvedValue([row(3, "mico", true), row(2, "manual"), row(1, "restore")]),
    restore: vi.fn().mockResolvedValue({ ...draft, version: 4 }),
  };
  const onRestored = vi.fn();
  await act(async () =>
    root.render(
      <DraftHistory
        client={{ webs: { history } } as never}
        draft={draft}
        dirty={dirty}
        disabled={false}
        onRestored={onRestored}
      />,
    ),
  );
  expect(history.list).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  return { history, onRestored };
}
it("loads history only when opened and restores against the current version", async () => {
  const { history, onRestored } = await mount(false);
  expect(history.list).toHaveBeenCalledWith({ id: draft.id });
  expect(host.textContent).toContain("Editado por tu Mico");
  expect(host.textContent).toContain("Actual");
  expect(host.querySelector('[aria-label="Restaurar la versión 3"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Restaurar la versión 2"]')!.click(),
  );
  expect(history.restore).toHaveBeenCalledWith({
    id: draft.id,
    snapshotId: row(2, "manual").id,
    version: 3,
  });
  expect(onRestored).toHaveBeenCalledWith({ ...draft, version: 4 }, row(2, "manual"));
});
it("never restores over unsaved changes", async () => {
  const { history } = await mount(true);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Restaurar la versión 2"]')!;
  expect(button.disabled).toBe(true);
  expect(host.textContent).toContain("Guarda o descarta tus cambios");
  await act(async () => button.click());
  expect(history.restore).not.toHaveBeenCalled();
});
