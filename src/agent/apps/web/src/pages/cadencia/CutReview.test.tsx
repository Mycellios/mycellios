// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: {
    children: ReactNode;
    variant?: string;
    size?: string;
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
import { CutReview } from "./CutReview";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
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
it("lets the owner audition a proposed vowel cut before opting in", async () => {
  const onPlay = vi.fn().mockResolvedValue(undefined),
    onChange = vi.fn();
  const cut = {
    id: "vowel",
    kind: "vowel" as const,
    start: 1,
    end: 2,
    enabled: false,
  };
  await act(async () =>
    root.render(
      <CutReview
        cuts={[cut]}
        total={3}
        busy=""
        active="vowel"
        audition=""
        error=""
        onClear={() => {}}
        onSelect={() => {}}
        onChange={onChange}
        onPlay={onPlay}
        onStop={() => {}}
      />,
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked,
  ).toBe(false);
  const after = host.querySelector<HTMLButtonElement>(
    '[aria-label="Escuchar después del corte 1"]',
  )!;
  expect(after.disabled).toBe(false);
  await act(async () => after.click());
  expect(onPlay).toHaveBeenCalledWith(cut, true);
  expect(onChange).not.toHaveBeenCalled();
});
it("blocks editing and auditioning during an in-flight export", async () => {
  await act(async () =>
    root.render(
      <CutReview
        cuts={[{ id: "cut", kind: "silence", start: 1, end: 2, enabled: true }]}
        total={3}
        busy="Rendering"
        active="cut"
        audition=""
        error=""
        onClear={() => {}}
        onSelect={() => {}}
        onChange={() => {}}
        onPlay={async () => {}}
        onStop={() => {}}
      />,
    ),
  );
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  expect(
    [...host.querySelectorAll<HTMLInputElement>("input")].every(
      (input) => input.disabled,
    ),
  ).toBe(true);
});
