// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type DictationSnapshot, dictation } from "../../lib/dictation";
import { TaskComposer } from "./TaskComposer";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
const listeners = new Set<(state: DictationSnapshot) => void>();
let finish: ((text: string) => void) | null = null;
vi.mock("../../lib/dictation", () => ({
  dictation: {
    subscribe: vi.fn((listener: (state: DictationSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    listen: vi.fn(async (input: { onFinal: (text: string) => void }) => {
      finish = input.onFinal;
      for (const listener of listeners) listener({ status: "listening", transcript: "" });
    }),
    submitHold: vi.fn(() => {
      finish?.("dictated task");
      finish = null;
      for (const listener of listeners) listener({ status: "idle", transcript: "" });
    }),
    stop: vi.fn(() => {
      finish = null;
    }),
  },
}));
const submit = vi.fn();
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
function Harness() {
  const [value, setValue] = useState("draft");
  return (
    <TaskComposer
      value={value}
      onChange={setValue}
      onSubmit={submit}
      bots={[{ id: "a", name: "Mico", color: "#9B5CF6" } as Bot]}
      botId="a"
      onAgent={() => {}}
      disabled={false}
    />
  );
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw Error(`Missing ${label}`);
  await act(async () => button.click());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.clearAllMocks();
  listeners.clear();
  finish = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("dictates into the task draft without automatically submitting", async () => {
  await click("Dictate task");
  expect(dictation.listen).toHaveBeenCalledWith(expect.objectContaining({ mode: "hold" }));
  await click("Finish dictation");
  expect(container.querySelector("textarea")?.value).toBe("draft dictated task");
  expect(submit).not.toHaveBeenCalled();
});
it("submits the combined draft only when Send is pressed during dictation", async () => {
  await click("Dictate task");
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(submit).toHaveBeenCalledWith("draft dictated task");
});
it("cancels owned recording on task switch and never submits it", async () => {
  await click("Dictate task");
  await click("Cancel recording");
  expect(dictation.stop).toHaveBeenCalledWith("cancel");
  expect(submit).not.toHaveBeenCalled();
});
it("prepares native voice only after explicit action and then starts dictation", async () => {
  let ready = false;
  const native = {
    status: vi.fn(async () => ({ ready, preparing: false, downloaded: 0, total: 0 })),
    prepare: vi.fn(async () => {
      ready = true;
    }),
  };
  vi.stubGlobal("rakazoDesktop", { localVoice: native });
  await click("Dictate task");
  expect(dictation.listen).not.toHaveBeenCalled();
  expect(native.prepare).not.toHaveBeenCalled();
  const prepare = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Prepare local voice",
  );
  expect(prepare).toBeDefined();
  await act(async () => prepare!.click());
  expect(native.prepare).toHaveBeenCalledOnce();
  expect(dictation.listen).toHaveBeenCalledOnce();
});
