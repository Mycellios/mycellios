// @vitest-environment jsdom
import { i18n } from "@lingui/core";
import { desktopDiagnosticMessage } from "@mycellios/contracts";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((s, p, i) => s + (i ? values[i - 1] : "") + p, ""),
  }),
}));
import { ComposerError } from "./composer-error";
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(copy?: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  document.elementFromPoint ??= () => null;
  vi.stubGlobal("navigator", { clipboard: copy ? { writeText: copy } : undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const retry = vi.fn();
  await act(async () =>
    root!.render(
      <ComposerError
        sendError={null}
        runError={desktopDiagnosticMessage({
          code: "desktop_disconnected",
          phase: "run",
          stage: "poll",
          operationId: "12345678-1234-4321-8765-123456789abc",
        })}
        runErrorId="cm00000000000000000000002"
        onRunErrorPresented={vi.fn()}
        onOpenModels={vi.fn()}
        onOpenConnections={vi.fn()}
        onDismissError={vi.fn()}
        onRetryError={retry}
        textareaRef={createRef()}
      />,
    ),
  );
  return retry;
}
it("copies the code and execution ID without retrying uncertain work", async () => {
  const copy = vi.fn().mockResolvedValue(undefined),
    retry = await mount(copy);
  const button = Array.from(container!.querySelectorAll("button")).find(
    (b) => b.textContent === "Copy diagnostics",
  )!;
  expect(container!.querySelector('[data-testid="composer-error-retry"]')).toBeNull();
  await act(async () => button.click());
  expect(JSON.parse(copy.mock.calls[0]![0])).toMatchObject({
    runId: "cm00000000000000000000002",
    code: "desktop_disconnected",
    outcome: "unconfirmed",
  });
  expect(container!.textContent).toContain("Copied");
  expect(retry).not.toHaveBeenCalled();
});
it("handles unavailable clipboard and leaves the execution ID selectable", async () => {
  const retry = await mount();
  const button = Array.from(container!.querySelectorAll("button")).find(
    (b) => b.textContent === "Copy diagnostics",
  )!;
  await act(async () => button.click());
  expect(container!.textContent).toContain(
    "Could not copy details. Select the execution ID instead.",
  );
  expect(container!.querySelector(".select-all")?.textContent).toBe("cm00000000000000000000002");
  expect(retry).not.toHaveBeenCalled();
});
