// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QuestionnaireCard } from "./QuestionnaireCard";
import type { AskBlock } from "./AskCard";
vi.mock("@lingui/react/macro", () => ({ Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }) }));
vi.mock("@rakazo/chat-ui/web", () => ({ ChatMarkdown: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const block: AskBlock = { kind: "ask", text: "Where?", actions: [{ id: "p", label: "Paris" }, { id: "l", label: "London" }], status: "pending" };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.getAttribute("aria-label") === label || b.textContent === label)!;
async function show(value = block, answer = vi.fn<(text: string) => Promise<void>>(async () => {}), canAnswer = true) {
  await act(async () => root.render(<QuestionnaireCard block={value} canAnswer={canAnswer} onAnswer={answer} />)); return answer;
}
async function type(value: string) {
  await act(async () => { const field = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("shows selection feedback, then resumes once with the original choice ID", async () => {
  const answer = await show();
  expect(button("Done").disabled).toBe(true);
  await act(async () => button("Paris").click());
  expect(answer).not.toHaveBeenCalled();
  expect(button("Paris").getAttribute("aria-pressed")).toBe("true");
  await act(async () => vi.advanceTimersByTime(180));
  expect(answer).toHaveBeenCalledExactlyOnceWith("p");
  expect(host.querySelector('[data-testid="answered-question-card"]')?.textContent).toContain("Paris");
});
it("lets a custom answer replace the selection and cancels automatic advance", async () => {
  const answer = await show();
  await act(async () => button("Paris").click()); await type("Barcelona");
  await act(async () => vi.advanceTimersByTime(200)); expect(answer).not.toHaveBeenCalled();
  await act(async () => button("Done").click()); expect(answer).toHaveBeenCalledExactlyOnceWith("Barcelona");
});
it("keeps earlier answers when navigating grouped questions and sends the group once", async () => {
  const answer = await show({ ...block, questions: [
    { id: "where", question: "Where?", options: [{ id: "p", label: "Paris", description: "Museums" }] },
    { id: "when", question: "When?", options: [] },
  ] });
  expect(host.textContent).toContain("Museums");
  await act(async () => button("Paris").click()); await act(async () => vi.advanceTimersByTime(180));
  expect(answer).not.toHaveBeenCalled(); await type("Tomorrow");
  await act(async () => button("Previous question").click());
  expect(button("Paris").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Next question").click()); expect(host.querySelector("input")?.value).toBe("Tomorrow");
  await act(async () => button("Done").click()); expect(answer).toHaveBeenCalledExactlyOnceWith("Where?\nParis\n\nWhen?\nTomorrow");
});
it("waits for Done on multiple selection and combines selected and typed values", async () => {
  const answer = await show({ ...block, questions: [{ id: "where", question: "Where?", options: block.actions!, multiSelect: true }] });
  await act(async () => button("Paris").click()); await act(async () => button("London").click()); await type("Rome");
  await act(async () => vi.advanceTimersByTime(300)); expect(answer).not.toHaveBeenCalled();
  await act(async () => button("Done").click()); expect(answer).toHaveBeenCalledExactlyOnceWith("Where?\nParis; London; Rome");
});
it("makes Skip and close explicit non-answers, never approvals", async () => {
  const answer = await show(); await act(async () => button("Skip").click());
  expect(answer.mock.calls[0]?.[0]).toContain("no answer or authorization");
});
it("retains the draft after a failed submission for a deliberate retry", async () => {
  const answer = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  await show(block, answer); await type("Rome"); await act(async () => button("Done").click());
  expect(host.textContent).toContain("Offline"); expect(host.querySelector("input")?.value).toBe("Rome");
  await act(async () => button("Done").click()); expect(answer).toHaveBeenCalledTimes(2);
});
it("cancels a scheduled choice when the card stops being answerable", async () => {
  const answer = await show(); await act(async () => button("Paris").click()); await show(block, answer, false);
  await act(async () => vi.advanceTimersByTime(300)); expect(answer).not.toHaveBeenCalled();
  expect(button("Paris").disabled).toBe(true);
});
it("supports option-letter keyboard shortcuts without submitting while typing", async () => {
  const answer = await show();
  await act(async () => host.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true })));
  await act(async () => vi.advanceTimersByTime(180)); expect(answer).toHaveBeenCalledExactlyOnceWith("l");
});
