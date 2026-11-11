// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../lib/rpc", () => ({
  rpc: {},
  createSpaceRpc: () => ({}),
  rpcForSpace: () => ({}),
  selectedSpaceId: () => null,
}));
vi.mock("./media", () => ({
  createDemo: vi.fn(),
  readMedia: vi.fn(),
  renderMedia: vi.fn(),
  stopError: () => new DOMException("Cancelled", "AbortError"),
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    children,
    variant,
    size,
    render,
    ...props
  }: {
    children: ReactNode;
    variant?: string;
    size?: string;
    render?: unknown;
  }) => <button {...props}>{children}</button>,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
  Input: (props: object) => <input {...props} />,
}));
import Cadencia from "./Cadencia";
import { queryClient } from "../../lib/query";
import { hasUnsavedEditorWork } from "../../lib/unsaved-editor-work";
import { blankState, readCadencia, saveCadencia } from "./state";

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("explicit close removes the selected file and its reload hold, revokes URLs and preserves the original file", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:synthetic"),
      revokeObjectURL: revoke,
    }),
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const file = new File([new Uint8Array([1, 2, 3])], "synthetic.wav", {
    type: "audio/wav",
  });
  saveCadencia("close-test", {
    ...blankState(),
    file,
    pcm: new Float32Array(16000),
    info: {
      duration: 1,
      origin: 0,
      sampleRate: 16000,
      channels: 1,
      width: 0,
      height: 0,
      video: false,
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<Cadencia scope="close-test" onBack={() => {}} />),
    );
    expect(hasUnsavedEditorWork()).toBe(true);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Cerrar archivo"]')!
        .click(),
    );
    const close = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Cerrar y descartar",
    )!;
    await act(async () => close.click());
    expect(host.textContent).toContain("Elegir vídeo");
    expect(readCadencia("close-test").file).toBeUndefined();
    expect(hasUnsavedEditorWork()).toBe(false);
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
    expect(file.size).toBe(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
