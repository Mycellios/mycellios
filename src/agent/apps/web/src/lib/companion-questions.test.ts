import { expect, it } from "vitest";
import { DesktopQuestionAnswerSchema, desktopQuestionAnswerText, type ThreadSnapshot } from "@rakazo/contracts";
import { companionQuestions } from "./companion-questions";
const ask = { kind: "ask", text: "Where?", status: "pending", actions: [{ id: "a", label: "Paris" }, { id: "b", label: "London" }] };
const fixture = (block: object = ask, status = "waiting_input") => ({ botId: "bot", messages: [{ id: "message", runId: "run", blocks: [block] }], run: { id: "run", status } }) as unknown as ThreadSnapshot;
it("exports only pending, non-secret, non-approval questions from the requested Mico", () => {
  expect(companionQuestions("bot", fixture())).toHaveLength(1);
  for (const block of [{ ...ask, status: "answered" }, { ...ask, input: "secret" }, { ...ask, approvalEffectId: "effect" }, { ...ask, credential: {} }, { ...ask, instructionUpdate: {} }])
    expect(companionQuestions("bot", fixture(block))).toEqual([]);
  expect(companionQuestions("foreign", fixture())).toEqual([]);
  expect(companionQuestions("bot", fixture(ask, "queued"))).toEqual([]);
});
it("serializes legacy answers using the real choice ID and rejects invented IDs or partial forms", () => {
  const prompt = companionQuestions("bot", fixture())[0]!;
  const reply = DesktopQuestionAnswerSchema.parse({ scope: "owner:space", promptId: prompt.id, nonce: "nonce",
    answers: [{ questionId: "question-1", optionIds: ["a"], text: "" }] });
  expect(desktopQuestionAnswerText(prompt, reply)).toBe("a");
  expect(() => desktopQuestionAnswerText(prompt, { ...reply, answers: [] })).toThrow();
  expect(() => desktopQuestionAnswerText(prompt, { ...reply, answers: [{ ...reply.answers[0]!, optionIds: ["admin"] }] })).toThrow();
  expect(() => desktopQuestionAnswerText(prompt, { ...reply, answers: [{ ...reply.answers[0]!, optionIds: ["a", "b"] }] })).toThrow();
});
it("preserves grouped and multiple answers without granting approval", () => {
  const prompt = companionQuestions("bot", fixture({ ...ask, questions: [
    { id: "where", question: "Where?", multiSelect: true, options: [{ id: "a", label: "Paris" }, { id: "b", label: "London" }] },
    { id: "when", question: "When?", options: [] },
  ] }))[0]!;
  const reply = { scope: "owner:space", promptId: prompt.id, nonce: "nonce", answers: [
    { questionId: "where", optionIds: ["a", "b"], text: "Rome" }, { questionId: "when", optionIds: [], text: "Tomorrow" },
  ] };
  expect(desktopQuestionAnswerText(prompt, reply)).toBe("Where?\nParis; London; Rome\n\nWhen?\nTomorrow");
});
