import { expect, it, vi } from "vitest";
import { isPausingAskTool, pausingQuestionnaire } from "./ask-user-questionnaire.js";
import { autoStartPlan, reconcilePlanAutoStarts } from "./plan-autostart.js";
import { planCardQuestionnaire } from "./plan-card.js";

it("builds a plan card with fixed answers and its steps", () => {
  expect(planCardQuestionnaire({
    message: "On it: fixing the 502 on staging.",
    steps: [{ label: "First", step: "Read the proxy logs" }, { label: "Then", step: "Fix the upstream" }],
    alternative: "Only diagnose",
  })).toEqual({
    text: "On it: fixing the 502 on staging.",
    actions: [{ id: "start", label: "Start" }, { id: "alternative", label: "Only diagnose" }, { id: "cancel", label: "Cancel" }],
    plan: { steps: [{ label: "First", text: "Read the proxy logs" }, { label: "Then", text: "Fix the upstream" }] },
  });
  expect(() => planCardQuestionnaire({ message: "x", steps: [] })).toThrow();
});

it("pauses on both question cards and plan cards", () => {
  expect(isPausingAskTool("acknowledge_request")).toBe(true);
  expect(isPausingAskTool("ask_user")).toBe(true);
  expect(isPausingAskTool("shell")).toBe(false);
  expect(pausingQuestionnaire("acknowledge_request", { message: "On it.", steps: [{ label: "First", step: "Look" }] }))
    .toHaveProperty("plan");
});

it("presses Start on a waiting plan card and queues the run, and does nothing otherwise", async () => {
  const card = { id: "m1", blocks: [{ kind: "ask", text: "On it.", status: "pending", plan: { steps: [{ label: "First", text: "Look" }] } }] };
  const answerRunInput = vi.fn(async () => true);
  const enqueue = vi.fn(async () => undefined);
  const prisma = {
    run: { findUnique: vi.fn(async () => ({ status: "waiting_input", spaceId: "s", threadId: "t", userId: "u" })) },
    message: { findMany: vi.fn(async () => [card]) },
  };
  const deps = { prisma, events: { answerRunInput }, jobs: { enqueue } } as unknown as Parameters<typeof autoStartPlan>[0];
  expect(await autoStartPlan(deps, "r1")).toBe(true);
  expect(answerRunInput).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1", messageId: "m1", answer: "start", autoStart: true, answeredByUserId: "u" }));
  expect(enqueue).toHaveBeenCalledTimes(1);

  prisma.run.findUnique.mockResolvedValueOnce({ status: "running", spaceId: "s", threadId: "t", userId: "u" });
  expect(await autoStartPlan(deps, "r1")).toBe(false);
  answerRunInput.mockResolvedValueOnce(false);
  expect(await autoStartPlan(deps, "r1")).toBe(false);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("restores the auto-start job of a waiting plan card", async () => {
  const autoStartAt = new Date(Date.now() + 5_000).toISOString();
  const enqueue = vi.fn(async () => undefined);
  const findMany = vi.fn(async () => [
    { runId: "r1", blocks: [{ kind: "ask", text: "On it.", status: "pending", plan: { steps: [{ label: "First", text: "Look" }], autoStartAt } }] },
    { runId: "r2", blocks: [{ kind: "ask", text: "Waits for a person.", status: "pending", plan: { steps: [{ label: "First", text: "Look" }] } }] },
  ]);
  await reconcilePlanAutoStarts({ prisma: { message: { findMany } }, jobs: { enqueue } } as unknown as Parameters<typeof reconcilePlanAutoStarts>[0]);
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "plan.autostart", payload: { runId: "r1" }, replaceKey: "plan.autostart:r1" }));
});
