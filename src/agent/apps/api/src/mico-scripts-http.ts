import { runContinueJob, type JobPublisher } from "@mycellios/adapter-kit";
import {
  MessageBlock,
  MICO_SCRIPT_ANSWER_MAX_LENGTH,
  MICO_SCRIPT_MAX_BODY_BYTES,
  MicoScriptAnswerInputSchema,
  MicoScriptMessageInputSchema,
  MicoScriptRoutineRunInputSchema,
  type MicoScriptDelivery,
  type MicoScriptInfo,
  type MicoScriptPending,
  type MicoScriptQuestion,
} from "@mycellios/contracts";
import type { MicoScriptRunInput, PrismaClient, ThreadEvents } from "@mycellios/db";
import {
  findMicoScriptCredential, findMicoScriptDelivery, findMicoScriptQuestionDelivery,
  currentMicoScriptQuestion, listWaitingMicoScripts, MicoScriptAdmission,
  runAsSystem, runAsTenant,
} from "@mycellios/db";
import { getLogger, redactSensitiveText } from "@mycellios/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import { formatUntrustedDeliveryPayload } from "./webhook-inbound.js";

export async function authenticateMicoScript(
  prisma: PrismaClient, botId: string, authorization: string | undefined,
) {
  if (!authorization || authorization.length > 64 || botId.length > 128) return null;
  const bearer = /^Bearer (mycs_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!bearer) return null;
  return runAsSystem("resolve bearer credential for a Mico Script", () =>
    findMicoScriptCredential(prisma, botId, bearer[1]!),
  );
}

type Credential = NonNullable<Awaited<ReturnType<typeof authenticateMicoScript>>>;
type MicoScriptsDeps = {
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "sendUserMessage" | "answerRunInput">;
  jobs: Pick<JobPublisher, "enqueue">;
};

function redactScriptText(text: string) {
  return redactSensitiveText(text.replace(/\b(?:mycs|whsec)_[A-Za-z0-9+/=_-]+/g, "[REDACTED]"));
}

async function ordinaryQuestion(
  prisma: PrismaClient, delivery: MicoScriptDelivery,
): Promise<MicoScriptQuestion | null> {
  if (!delivery.runId || !delivery.conversationId) return null;
  const question = await currentMicoScriptQuestion(prisma, delivery.conversationId, delivery.runId);
  if (!question) return null;
  const { ask } = question;
  return {
      id: question.id, deliveryId: delivery.id, conversationId: delivery.conversationId,
      askedAt: question.createdAt.toISOString(), text: redactScriptText(ask.text),
      options: (ask.actions ?? []).map((option) => ({
        id: redactScriptText(option.id), label: redactScriptText(option.label),
      })),
      questions: ask.questions?.map((question) => ({
        id: redactScriptText(question.id), question: redactScriptText(question.question),
        multiSelect: question.multiSelect,
        options: question.options.map((option) => ({
          id: redactScriptText(option.id), label: redactScriptText(option.label),
          description: option.description ? redactScriptText(option.description) : undefined,
        })),
      })),
  };
}

async function deliveryStatus(prisma: PrismaClient, credential: Credential, deliveryId: string): Promise<MicoScriptDelivery | null> {
  const delivery = await findMicoScriptDelivery(prisma, credential, deliveryId);
  if (!delivery?.messageId) return null;
  const run = await prisma.run.findFirst({
    where: {
      sourceMessageId: delivery.messageId, threadId: delivery.threadId,
      botId: delivery.botId, spaceId: delivery.spaceId, userId: delivery.userId,
    },
    select: { id: true, status: true, completedAt: true },
  });
  const view: MicoScriptDelivery = {
    id: delivery.id,
    kind: delivery.kind === "routine" ? "routine" : "message",
    status: "queued",
    createdAt: delivery.createdAt.toISOString(),
    conversationId: delivery.threadId,
    routineId: delivery.routineId,
    runId: run?.id ?? null,
    endedAt: run?.completedAt?.toISOString() ?? null,
    waitingFor: null,
    answer: null,
    error: null,
  };
  if (!run) {
    const pending = await prisma.steeringMessage.findUnique({
      where: { messageId_botId: { messageId: delivery.messageId, botId: delivery.botId } },
      select: { id: true },
    });
    if (!pending) view.status = "cancelled";
    return view;
  }
  if (run.status === "leased" || run.status === "running") view.status = "running";
  if (run.status === "waiting_input" || run.status === "waiting_takeover") {
    view.status = "waiting";
    view.waitingFor = "mycellios";
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    view.status = run.status;
    if (run.status === "failed") view.error = "Mico run failed.";
  }
  if (run.status === "waiting_input" && await ordinaryQuestion(prisma, view)) view.waitingFor = "question";
  if (run.status === "completed") {
    const message = await prisma.message.findFirst({
      where: { runId: run.id, threadId: delivery.threadId, role: "bot" },
      orderBy: { seq: "desc" },
      select: { blocks: true },
    });
    const parsed = MessageBlock.array().safeParse(message?.blocks);
    if (parsed.success) {
      const text = parsed.data.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n").trim();
      if (text) view.answer = redactScriptText(text).slice(0, MICO_SCRIPT_ANSWER_MAX_LENGTH);
    }
  }
  return view;
}

export function mountMicoScriptsHttp(app: Hono, deps: MicoScriptsDeps) {
  const { prisma } = deps;
  app.get("/api/v1/micos/:botId", async (c) => {
    c.header("cache-control", "private, no-store");
    const botId = c.req.param("botId");
    const scope = await authenticateMicoScript(prisma, botId, c.req.header("authorization"));
    const unavailable = () => c.json({ error: "Mico unavailable" }, 404);
    if (!scope) return unavailable();
    return runAsTenant(scope, async () => {
      const owner = { botId, spaceId: scope.spaceId, userId: scope.userId };
      const mico = await prisma.bot.findFirst({
        where: { id: botId, spaceId: owner.spaceId, userId: owner.userId, archivedAt: null },
        select: { id: true, name: true },
      });
      if (!mico) return unavailable();
      const routines = await prisma.routine.findMany({
        where: owner,
        select: { id: true, name: true, active: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return c.json({ mico, routines, requestsPerHour: scope.requestsPerHour } satisfies MicoScriptInfo);
    });
  });

  app.on("POST", ["/api/v1/micos/:botId/messages", "/api/v1/micos/:botId/routines/:routineId/run"], async (c) => {
    c.header("cache-control", "private, no-store");
    const botId = c.req.param("botId");
    const scope = await authenticateMicoScript(prisma, botId, c.req.header("authorization"));
    const unavailable = () => c.json({ error: "Mico unavailable" }, 404);
    if (!scope) return unavailable();
    const raw = await readBoundedBody(c.req.raw, MICO_SCRIPT_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const routineId = c.req.param("routineId");
    let input: MicoScriptRunInput;
    if (routineId !== undefined) {
      if (routineId.length > 128) return unavailable();
      const parsed = MicoScriptRoutineRunInputSchema.safeParse(json);
      if (!parsed.success) return c.json({ error: "Invalid routine request" }, 400);
      input = { kind: "routine", routineId, ...parsed.data };
    } else {
      const parsed = MicoScriptMessageInputSchema.safeParse(json);
      if (!parsed.success) return c.json({ error: "Invalid message" }, 400);
      input = { kind: "message", ...parsed.data };
    }
    return runAsTenant(scope, async () => {
      // Script tokens create unattended runs. The text cannot confer the privileges of an owner message.
      const prompt = input.kind === "message"
        ? formatUntrustedDeliveryPayload("[Mico Script message]", { text: input.text }) : "";
      try {
        const sent = await deps.events.sendUserMessage({
          botId, spaceId: scope.spaceId, userId: scope.userId, threadId: "",
          blocks: [{ kind: "text", text: prompt }], prompt, trigger: "webhook",
          linkMessageToRun: true, script: { credential: scope, input },
        });
        if (sent.runId && sent.taskId) await deps.jobs.enqueue(runContinueJob(sent.runId)).catch((error) => {
          getLogger().error("Mico Script delivery enqueue failed", error);
        });
        const delivery = sent.scriptDeliveryId ? await deliveryStatus(prisma, scope, sent.scriptDeliveryId) : null;
        return delivery ? c.json({ ...delivery, duplicate: false }, 202) : unavailable();
      } catch (error) {
        if (!(error instanceof MicoScriptAdmission)) throw error;
        if (error.kind === "duplicate" && error.deliveryId) {
          const delivery = await deliveryStatus(prisma, scope, error.deliveryId);
          return delivery ? c.json({ ...delivery, duplicate: true }, 202) : unavailable();
        }
        if (error.kind === "rate_limit") {
          return c.json({ error: "Hourly request limit reached" }, 429, { "retry-after": String(error.retryAfter ?? 1) });
        }
        if (error.kind === "conflict") return c.json({ error: "Retry key already in use" }, 409);
        return unavailable();
      }
    });
  });

  app.get("/api/v1/micos/:botId/deliveries/:id", async (c) => {
    c.header("cache-control", "private, no-store");
    const scope = await authenticateMicoScript(prisma, c.req.param("botId"), c.req.header("authorization"));
    const id = c.req.param("id");
    const delivery = scope && id.length <= 128
      ? await runAsTenant(scope, () => deliveryStatus(prisma, scope, id))
      : null;
    return delivery ? c.json(delivery) : c.json({ error: "Mico unavailable" }, 404);
  });

  app.get("/api/v1/micos/:botId/pending", async (c) => {
    c.header("cache-control", "private, no-store");
    const scope = await authenticateMicoScript(prisma, c.req.param("botId"), c.req.header("authorization"));
    if (!scope) return c.json({ error: "Mico unavailable" }, 404);
    return runAsTenant(scope, async () => {
      const pending: MicoScriptPending = { questions: [], inMycellios: [] };
      for (const row of await listWaitingMicoScripts(prisma, scope)) {
        const delivery = await deliveryStatus(prisma, scope, row.id);
        if (delivery?.status !== "waiting") continue;
        const question = delivery.waitingFor === "question" && await ordinaryQuestion(prisma, delivery);
        if (question) pending.questions.push(question);
        else pending.inMycellios.push({ deliveryId: delivery.id, since: delivery.createdAt });
      }
      return c.json(pending);
    });
  });

  app.post("/api/v1/micos/:botId/questions/:id/answer", async (c) => {
    c.header("cache-control", "private, no-store");
    const scope = await authenticateMicoScript(prisma, c.req.param("botId"), c.req.header("authorization"));
    const id = c.req.param("id");
    const unavailable = () => c.json({ error: "Mico unavailable" }, 404);
    if (!scope || id.length > 128) return unavailable();
    const raw = await readBoundedBody(c.req.raw, MICO_SCRIPT_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    const parsed = MicoScriptAnswerInputSchema.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid answer" }, 400);
    return runAsTenant(scope, async () => {
      const [target] = await findMicoScriptQuestionDelivery(prisma, scope, id);
      if (!target) return unavailable();
      const accepted = await deps.events.answerRunInput({
        spaceId: scope.spaceId, threadId: target.threadId, runId: target.runId, messageId: id,
        answeredByUserId: scope.userId, answer: parsed.data.answer,
        script: { credential: scope, deliveryId: target.id },
      });
      if (!accepted) return unavailable();
      await deps.jobs.enqueue(runContinueJob(target.runId)).catch((error) => {
        getLogger().error("Mico Script answer enqueue failed", error);
      });
      return c.json({ ok: true });
    });
  });
}
