import { expect, it } from "vitest";
import { withLivePlan } from "./events.js";
import { planCardResumeText } from "./plan-card.js";

it("tells the Mico what each plan card answer means", () => {
  expect(planCardResumeText({ choiceId: "start", answer: "start" })).toContain("Carry out the plan");
  expect(planCardResumeText({ choiceId: "start", answer: "start", autoStarted: true })).toContain("started by itself");
  expect(planCardResumeText({ choiceId: "alternative", choiceLabel: "Only check logs", answer: "alternative" }))
    .toContain('"Only check logs". Do only that');
  expect(planCardResumeText({ choiceId: "cancel", answer: "cancel" })).toContain("Do not start");
  expect(planCardResumeText({ answer: "[Question skipped; no answer or authorization was provided.]" })).toContain("skipped");
  expect(planCardResumeText({ answer: "Do it tomorrow" })).toContain('"Do it tomorrow". Follow that answer');
});

it("keeps the latest live plan at the top of the running message", () => {
  const plan = (title: string) => ({ kind: "plan", steps: [{ title, status: "running" }] });
  const first = withLivePlan([{ kind: "text", text: "Looking." }], { plan: plan("Read logs") });
  expect(first[0]).toEqual(plan("Read logs"));
  const next = withLivePlan(first, { plan: plan("Fix build") });
  expect(next.filter(block => block.kind === "plan")).toEqual([plan("Fix build")]);
  expect(withLivePlan(next, { name: "shell" })).toEqual(next);
});
