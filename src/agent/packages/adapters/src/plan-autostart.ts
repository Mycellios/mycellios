import type { JobPublisher } from "@mycellios/adapter-kit";
import { planAutoStartJob, runContinueJob } from "@mycellios/adapter-kit";
import { MessageBlock } from "@mycellios/contracts";
import { PLAN_START } from "@mycellios/core";
import type { PrismaClient, ThreadEvents } from "@mycellios/db";

/**
 * Presses Start on a run's plan card when nobody answered within its wait. The answer goes through
 * the same fenced commit as a person's, which refuses it once the card is answered or the wait has
 * not passed, so a late or repeated job changes nothing.
 */
export async function autoStartPlan(
  deps: { prisma: PrismaClient; events: ThreadEvents; jobs: JobPublisher },
  runId: string,
): Promise<boolean> {
  const run = await deps.prisma.run.findUnique({
    where: { id: runId },
    select: { status: true, spaceId: true, threadId: true, userId: true },
  });
  if (run?.status !== "waiting_input") return false;
  const messages = await deps.prisma.message.findMany({
    where: { runId, threadId: run.threadId, role: "bot" },
    orderBy: { seq: "desc" },
    take: 5,
    select: { id: true, blocks: true },
  });
  const card = messages.find((message) => {
    const blocks = MessageBlock.array().safeParse(message.blocks);
    return blocks.success && blocks.data.some((block) => block.kind === "ask" && block.status !== "answered" && block.plan);
  });
  if (!card) return false;
  const answered = await deps.events.answerRunInput({
    spaceId: run.spaceId,
    threadId: run.threadId,
    runId,
    messageId: card.id,
    answeredByUserId: run.userId,
    answer: PLAN_START,
    autoStart: true,
  });
  if (answered) await deps.jobs.enqueue(runContinueJob(runId));
  return answered;
}

/**
 * Restores auto-start jobs that a process interruption lost between pausing the run and queueing
 * the job. The job's replace key keeps one job per run, and the commit refuses a card that is
 * already answered, so restoring a job that still exists changes nothing.
 */
export async function reconcilePlanAutoStarts(deps: { prisma: PrismaClient; jobs: JobPublisher }) {
  const cards = await deps.prisma.message.findMany({
    where: {
      role: "bot",
      AND: [
        { blocks: { path: ["0", "kind"], equals: "ask" } },
        { blocks: { path: ["0", "status"], equals: "pending" } },
        { blocks: { path: ["0", "plan", "autoStartAt"], string_starts_with: "2" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { runId: true, blocks: true },
  });
  for (const card of cards) {
    const blocks = MessageBlock.array().safeParse(card.blocks);
    const ask = blocks.success ? blocks.data[0] : undefined;
    const autoStartAt = ask?.kind === "ask" ? ask.plan?.autoStartAt : undefined;
    if (card.runId && autoStartAt) await deps.jobs.enqueue(planAutoStartJob(card.runId, new Date(autoStartAt)));
  }
}
