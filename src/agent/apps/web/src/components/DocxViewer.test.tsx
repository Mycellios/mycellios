// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../lib/docx-preview", async (original) => ({
  ...(await original<typeof import("../lib/docx-preview")>()),
  docxPreviewHtml: mocks.preview,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

import { DocxPreviewError } from "../lib/docx-preview";
import { DocxViewer } from "./DocxViewer";

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.preview.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows the converted document and keeps footnote links inside the preview", async () => {
  mocks.preview.mockResolvedValue(
    '<h1>Report</h1><p><a href="#docx-note">1</a></p><p id="docx-note">Note</p>',
  );
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const bytes = new Uint8Array([1]);
  await act(async () => root.render(<DocxViewer bytes={bytes} />));
  expect(mocks.preview).toHaveBeenCalledWith(
    bytes,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(container.querySelector("article h1")?.textContent).toBe("Report");
  const link = container.querySelector("a")!;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => link.dispatchEvent(click));
  expect(click.defaultPrevented).toBe(true);
  expect(scroll).toHaveBeenCalledTimes(1);
});

it.each([
  ["too_large", "This file is too large."],
  ["unreadable", "Could not load this file."],
] as const)("explains a %s document without rendering it", async (reason, message) => {
  mocks.preview.mockRejectedValue(new DocxPreviewError(reason));
  await act(async () => root.render(<DocxViewer bytes={new Uint8Array([1])} />));
  expect(container.querySelector("article")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
});

it("cancels the conversion when the preview closes", async () => {
  mocks.preview.mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(<DocxViewer bytes={new Uint8Array([1])} />));
  const { signal } = mocks.preview.mock.calls[0]![1] as { signal: AbortSignal };
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  root = createRoot(container);
});
