// @vitest-environment jsdom
import type { HostedWebDraft } from "@mycellios/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@mycellios/ui-web", () => ({
  Button: ({
    children,
    render,
    ...props
  }: {
    children: ReactNode;
    render?: unknown;
  }) => <button {...props}>{children}</button>,
  Input: (props: object) => <input {...props} />,
  Textarea: (props: object) => <textarea {...props} />,
  NativeSelect: (props: object) => <select {...props} />,
  NativeSelectOption: (props: object) => <option {...props} />,
  Disclosure: ({ summary, children }: { summary: ReactNode; children: ReactNode }) => (
    <section>
      <h3>{summary}</h3>
      {children}
    </section>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (on: boolean) => void;
  }) => (
    <input
      type="checkbox"
      {...props}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
vi.mock("../tasks/TaskComposer", () => ({
  TaskAgentSelect: () => <span>Mico selector</span>,
}));
vi.mock("./HostedAppChat", () => ({
  HostedAppChat: () => <span>App chat</span>,
}));
vi.mock("../../lib/rpc", () => ({ rpc: {}, selectedSpaceId: () => "space" }));
import { queryClient } from "../../lib/query";
import { WebEditor } from "./HostedWebEditor";
import type { createSpaceRpc } from "../../lib/rpc";

const initial: HostedWebDraft = {
  id: "app",
  slug: "my-app",
  title: "Original",
  summary: "",
  version: 1,
  published: false,
  bundle: {
    files: [{ path: "index.html", base64: btoa("<h1>Original</h1>") }],
  },
};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount() {
  const next = {
    ...initial,
    version: 2,
    title: "Mico edit",
    bundle: {
      files: [{ path: "index.html", base64: btoa("<h1>Mico edit</h1>") }],
    },
  };
  const webs = {
    agent: vi.fn().mockResolvedValue(null),
    revision: vi.fn().mockResolvedValue(1),
    draft: vi.fn().mockResolvedValue(next),
    preview: vi
      .fn()
      .mockImplementation(({ version }) =>
        Promise.resolve({ path: `/preview/v${version}/index.html` }),
      ),
  };
  await act(async () =>
    root.render(
      <WebEditor
        scope="scope"
        initial={initial}
        client={{ webs } as unknown as ReturnType<typeof createSpaceRpc>}
        bots={[]}
        spaceId="space"
        onBack={() => {}}
        onPublished={() => {}}
        onShowBot={() => {}}
        onCreateBot={() => {}}
      />,
    ),
  );
  return webs;
}
it("refreshes the private preview when the assigned Mico saves a new version", async () => {
  const webs = await mount();
  expect(host.querySelector("iframe")?.getAttribute("src")).toContain(
    "/preview/v1/",
  );
  webs.revision.mockResolvedValue(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(host.querySelector("iframe")?.getAttribute("src")).toContain(
    "/preview/v2/",
  );
  expect(host.textContent).toContain("Mico edit");
  expect(host.textContent).toContain("Publicar app");
});
it("clears a transient synchronization failure after reconnecting", async () => {
  const webs = await mount();
  webs.revision.mockRejectedValueOnce(new Error("Gateway unavailable"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(host.textContent).toContain("Reintentando");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(host.textContent).not.toContain("Reintentando");
  expect(host.textContent).not.toContain("Gateway unavailable");
});
it("preserves dirty manual source when a remote draft changes", async () => {
  const webs = await mount();
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Código y archivos")!
      .click();
  });
  const editor = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor, "<h1>My manual edit</h1>");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("Cambios sin guardar");
  webs.revision.mockResolvedValue(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(editor.value).toBe("<h1>My manual edit</h1>");
  expect(webs.draft).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Tus cambios locales se conservan");
});
it("keeps owner-granted capabilities through code edits and sends them on save", async () => {
  const webs = (await mount()) as Awaited<ReturnType<typeof mount>> & {
    save?: ReturnType<typeof vi.fn>;
  };
  webs.save = vi.fn().mockImplementation((input) =>
    Promise.resolve({ ...initial, ...input, version: 2 }),
  );
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Código y archivos")!
      .click();
  });
  const downloads = host.querySelector<HTMLInputElement>('input[id$="-cap-downloads"]')!;
  expect(downloads.checked).toBe(false);
  await act(async () => downloads.click());
  expect(downloads.checked).toBe(true);
  const editor = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor, "<h1>Edited</h1>");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Guardar borrador"))!
      .click();
  });
  expect(webs.save).toHaveBeenCalledWith(
    expect.objectContaining({
      bundle: expect.objectContaining({ capabilities: ["downloads"] }),
    }),
  );
  await act(async () => downloads.click());
  expect(downloads.checked).toBe(false);
});
