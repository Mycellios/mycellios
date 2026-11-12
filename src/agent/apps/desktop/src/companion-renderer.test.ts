// @vitest-environment jsdom
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const source = readFileSync(fileURLToPath(import.meta.url).replace(/companion-renderer\.test\.ts$/, "companion.js"), "utf8");
let receive: (value: unknown) => void;
let bridge: any;
const prompt = { id: "run:message:0", botId: "bot", runId: "run", messageId: "message", legacy: true,
  questions: [{ id: "q", question: "Where?", options: [{ id: "a", label: "Paris", description: "Museums" }, { id: "b", label: "London" }] }] };
function state(expanded = true, questions = [prompt], scope = "owner:space") {
  return { kind: "island", prefs: { dock: { autoHide: false, edge: "right", edgeStrip: true } }, expanded,
    snapshot: { scope, theme: "light", questions, agents: [{ id: "bot", name: "Mico", status: "Waiting", color: "#3f9f78" }] } };
}
beforeEach(() => {
  document.body.innerHTML = '<main id="root"></main>';
  bridge = { onState: (fn: typeof receive) => { receive = fn; }, onHover: vi.fn(), expand: vi.fn(),
    select: vi.fn(), openQuestion: vi.fn(), answer: vi.fn(async () => "ok") };
  (window as any).companion = bridge;
  new Function(source)();
});
afterEach(() => { document.body.replaceChildren(); delete (window as any).companion; });
it("opens from the Questions pill and renders real labels and descriptions", () => {
  receive(state(false)); expect(document.querySelector(".island-pill")?.getAttribute("aria-label")).toBe("Mico · Preguntas");
  expect(document.querySelector(".island-name")).toBeNull();
  document.querySelector<HTMLButtonElement>(".island-pill")!.click(); expect(bridge.expand).toHaveBeenCalledWith(true);
  receive(state()); expect(document.body.textContent).toContain("Mico pregunta");
  expect(document.body.textContent).toContain("Museums");
});
it("sends a quick choice once, bound to scope, prompt and original option ID", async () => {
  receive(state()); const button = document.querySelector<HTMLButtonElement>(".island-question-option")!;
  button.click(); button.click(); await Promise.resolve();
  expect(bridge.answer).toHaveBeenCalledOnce();
  expect(bridge.answer.mock.calls[0][0]).toMatchObject({ scope: "owner:space", promptId: prompt.id,
    answers: [{ questionId: "q", optionIds: ["a"], text: "" }] });
});
it("collects grouped questions before sending and preserves typed input across polling", async () => {
  const grouped = { ...prompt, questions: [...prompt.questions, { id: "when", question: "When?", options: [] }] };
  receive(state(true, [grouped])); document.querySelector<HTMLButtonElement>(".island-question-option")!.click();
  expect(bridge.answer).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("When?");
  const input = document.querySelector<HTMLInputElement>("input")!; input.value = "Tomorrow"; input.dispatchEvent(new Event("input"));
  receive(state(true, [grouped])); expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Tomorrow");
  document.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true })); await Promise.resolve();
  expect(bridge.answer.mock.calls[0][0].answers).toEqual([{ questionId: "q", optionIds: ["a"], text: "" }, { questionId: "when", optionIds: [], text: "Tomorrow" }]);
});
it("Later keeps the request and the app button targets that exact request", () => {
  receive(state()); document.querySelector<HTMLButtonElement>(".island-later")!.click();
  expect(bridge.expand).toHaveBeenCalledWith(false); expect(bridge.answer).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>(".island-open")!.click(); expect(bridge.openQuestion).toHaveBeenCalledWith(prompt.id);
});
it("retains failed input and clears it when the account changes", async () => {
  bridge.answer.mockRejectedValueOnce(new Error("Private server detail")); receive(state());
  const input = document.querySelector<HTMLInputElement>("input")!; input.value = "Rome"; input.dispatchEvent(new Event("input"));
  document.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true })); await Promise.resolve(); await Promise.resolve();
  expect(document.body.textContent).not.toContain("Private server detail");
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("Rome");
  receive(state(true, [prompt], "different-owner:space")); expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("");
});
it("renders question text as text, never HTML", () => {
  receive(state(true, [{ ...prompt, questions: [{ ...prompt.questions[0]!, question: '<img src=x onerror="alert(1)">' }] }]));
  expect(document.querySelector("img[src=x]")).toBeNull(); expect(document.body.textContent).toContain("<img");
});
