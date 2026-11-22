// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clampTaskPanelWidth,
  TASK_PANEL_WIDTH_KEY,
  TaskPanelResizer,
  taskPanelMaxWidth,
  useTaskPanelWidth,
} from "./task-panel-width";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.dir = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the panel at least 320 px wide and leaves the list at least 320 px", () => {
  expect(clampTaskPanelWidth(200, 1200)).toBe(320);
  expect(clampTaskPanelWidth(500, 1200)).toBe(500);
  expect(clampTaskPanelWidth(1000, 1200)).toBe(880);
  expect(taskPanelMaxWidth(1200)).toBe(880);
  // With too little room for both, the panel keeps its minimum.
  expect(clampTaskPanelWidth(500, 600)).toBe(320);
  // Before the page is measured, only the minimum applies.
  expect(clampTaskPanelWidth(700, 0)).toBe(700);
  expect(clampTaskPanelWidth(Number.NaN, 1200)).toBe(420);
});

function Probe() {
  const body = useRef<HTMLDivElement>(null);
  const panel = useTaskPanelWidth(body);
  return (
    <div ref={body}>
      <output>{panel.width}</output>
      <TaskPanelResizer width={panel.width} max={panel.max} onResize={panel.resize} />
    </div>
  );
}
async function renderProbe(bodyWidth = 1200) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: bodyWidth,
  } as DOMRect);
  await act(async () => root.render(<Probe />));
  return host.querySelector<HTMLHRElement>('hr[aria-label="Resize panel"]')!;
}
const shown = () => Number(host.querySelector("output")!.textContent);
const press = (edge: HTMLElement, key: string) =>
  act(async () => {
    edge.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

it("resizes from the keyboard within its bounds and remembers the width on this device", async () => {
  const edge = await renderProbe();
  expect(shown()).toBe(420);
  expect(edge.getAttribute("aria-valuemin")).toBe("320");
  expect(edge.getAttribute("aria-valuemax")).toBe("880");
  await press(edge, "ArrowLeft");
  expect(shown()).toBe(452);
  await press(edge, "ArrowRight");
  await press(edge, "ArrowRight");
  expect(shown()).toBe(388);
  await press(edge, "End");
  expect(shown()).toBe(880);
  await press(edge, "Home");
  expect(shown()).toBe(320);
  await press(edge, "ArrowLeft");
  expect(localStorage.getItem(TASK_PANEL_WIDTH_KEY)).toBe("352");
  await act(async () => root.unmount());
  root = createRoot(host);
  await renderProbe();
  expect(shown()).toBe(352);
});

it("widens toward the list in right-to-left text too", async () => {
  document.documentElement.dir = "rtl";
  const edge = await renderProbe();
  await press(edge, "ArrowRight");
  expect(shown()).toBe(452);
});

it("fits a remembered width into a narrower window without forgetting it", async () => {
  localStorage.setItem(TASK_PANEL_WIDTH_KEY, "700");
  await renderProbe(800);
  expect(shown()).toBe(480);
  expect(localStorage.getItem(TASK_PANEL_WIDTH_KEY)).toBe("700");
});

it("follows a pointer drag on its edge", async () => {
  const edge = await renderProbe();
  const pointer = (type: string, clientX: number) =>
    act(async () => {
      const event = new MouseEvent(type, { bubbles: true, clientX, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      edge.dispatchEvent(event);
    });
  await pointer("pointerdown", 600);
  await pointer("pointermove", 500);
  expect(shown()).toBe(520);
  await pointer("pointerup", 500);
  await pointer("pointermove", 300);
  expect(shown()).toBe(520);
});
