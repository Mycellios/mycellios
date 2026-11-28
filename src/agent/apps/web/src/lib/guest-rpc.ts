import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import type { AppBootstrap, Bot, Me, ProductEvent, Run, SpaceNavigation, ThreadMessage, ThreadSnapshot } from "@mycellios/contracts";
import {
  GuestChatRequestError, guestApi, guestCache, guestHistory, withoutImages,
  type GuestMessage, type GuestPending, type GuestStatus,
} from "./guest-chat";
import {
  GUEST_BOT_ID, GUEST_SPACE_ID, GUEST_THREAD_ID, GUEST_USER_ID,
  GuestAccountRequiredError, guestLimits, promptGuestAccount, setGuestRemaining,
} from "./guest-mode";

/**
 * The guest shell's data layer. It answers the Agent procedures the shell reads with one fixed
 * Mico and a transcript kept only in this tab, sends messages to the coordinator's guest chat and
 * refuses everything else with GuestAccountRequiredError. It never calls the Agent API: a guest has
 * no account there, and the coordinator route enforces model, text-only input and limits itself.
 */
export const GUEST_MODEL_ID = "mycellios/managed/free";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

type CallOptions = { signal?: AbortSignal; lastEventId?: string };

let loaded = false;
let history: GuestMessage[] = [];
/** When each message was written, beside the transcript; older tabs fall back to the load time. */
let times: string[] = [];
const TIMES_KEY = "mycellios:guest:times";
let pending: GuestPending | null = null;
let status: GuestStatus | null = null;
let statusRead: Promise<GuestStatus | null> | null = null;
let running: { runId: string; controller: AbortController } | null = null;
let failedRun: { runId: string; input: GuestPending } | null = null;
let liveEvents: ProductEvent[] = [];
let eventSeq = 0;
const waiters = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  const cached = guestCache.load();
  history = cached.messages;
  pending = cached.pending;
  try {
    const stored = JSON.parse(sessionStorage.getItem(TIMES_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored)) times = stored.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  } catch { /* Times are only presentation. */ }
  const now = new Date().toISOString();
  times = history.map((_, index) => times[index] ?? now);
  eventSeq = history.length;
}

function save() {
  guestCache.save(history, pending);
  while (times.length < history.length) times.push(new Date().toISOString());
  times = times.slice(-history.length || 0);
  try { sessionStorage.setItem(TIMES_KEY, JSON.stringify(times)); } catch { /* Times are only presentation. */ }
}

/** The sidebar preview is plain text, like the server's. */
function plain(markdown: string): string {
  return withoutImages(markdown).replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~]+/g, "").replace(/\s+/g, " ").trim();
}

function messageOf(message: GuestMessage, index: number): ThreadMessage {
  return {
    id: `guest-message-${index}`,
    threadId: GUEST_THREAD_ID,
    seq: index + 1,
    role: message.role === "user" ? "user" : "bot",
    blocks: [{ kind: "text", text: message.role === "user" ? message.content : withoutImages(message.content) }],
    ...(message.role === "user" ? {} : { botId: GUEST_BOT_ID }),
    createdAt: times[index] ?? new Date().toISOString(),
  } as ThreadMessage;
}

function snapshot(): ThreadSnapshot {
  load();
  return {
    threadId: GUEST_THREAD_ID,
    botId: GUEST_BOT_ID,
    cursor: eventSeq,
    messages: history.map(messageOf),
    olderCursor: null,
    // The shell rereads the thread after a turn ends: it must find the same run state the events gave.
    run: lastRun,
    activeRuns: lastRun?.status === "running" ? [lastRun] : [],
  };
}

function guestBot(): Bot {
  load();
  const last = history.at(-1);
  return {
    id: GUEST_BOT_ID,
    spaceId: GUEST_SPACE_ID,
    name: "Mico",
    title: t`Free guest assistant`,
    description: t`Chats with a free model. Create an account for tools, files, memory and your own Micos.`,
    instructions: "",
    color: "#3f6b4c",
    notifyOnFinish: false,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: GUEST_THREAD_ID,
    preview: last ? plain(last.content).slice(0, 120) : "",
    status: running ? "running" : "idle",
    runErrorId: null,
    computerMode: "isolated",
    updatedAt: times.at(-1) ?? new Date().toISOString(),
    createdAt: CREATED_AT,
    voiceId: null,
    autoSpeak: false,
    modelProvider: "mycellios",
    modelId: GUEST_MODEL_ID,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    fleetManagement: false,
    disabledBuiltinTools: [],
    webhookConfigured: false,
    spawnKey: null,
  };
}

function me(): Me {
  return {
    ticketBoardEnabled: false,
    phoneCallsEnabled: false,
    spaceMembersEnabled: false,
    userId: GUEST_USER_ID,
    email: "guest@guest.invalid",
    name: t`Guest`,
    spaceId: GUEST_SPACE_ID,
    isDeploymentOwner: false,
    needsModel: false,
    defaultProvider: "mycellios",
    defaultModel: GUEST_MODEL_ID,
    hostCredentialProvider: null,
    hostCredentialSource: null,
    computerHost: null,
    canChooseHostComputer: false,
    sandboxProvider: "none",
    avatarStyle: "organic",
    timezone: null,
    billingEnabled: false,
    needsSignupSurvey: false,
  };
}

function navigation(): SpaceNavigation {
  const bot = guestBot();
  return {
    current: { id: GUEST_SPACE_ID, name: t`Guest`, bots: [bot], groups: [], externalConversations: [], botSections: [] },
    spaces: [{
      id: GUEST_SPACE_ID, name: t`Guest`, isDefault: true, hasContent: true, canRename: false, canDelete: false,
      bots: [bot], groups: [], externalConversations: [], botSections: [],
    }],
  } as SpaceNavigation;
}

function bootstrap(): AppBootstrap {
  void guestStatus();
  return {
    me: me(),
    bots: [guestBot()],
    groups: [],
    botSections: [],
    archivedBots: [],
    archivedGroups: [],
    thread: snapshot(),
    routines: [],
    spaces: navigation().spaces,
  };
}

/** The latest turn, as the thread snapshot reports it. */
let lastRun: Run | null = null;

function trackRun(type: ProductEvent["type"], payload: Record<string, unknown>, runId: string, at: string) {
  if (type === "run.started") {
    lastRun = { id: runId, botId: GUEST_BOT_ID, threadId: GUEST_THREAD_ID, taskId: GUEST_THREAD_ID, status: "running", trigger: "user",
      routineId: null, modelProvider: "mycellios", modelId: GUEST_MODEL_ID, error: null, startedAt: at, completedAt: null, createdAt: at, updatedAt: at } as Run;
  } else if (lastRun?.id === runId && (type === "run.completed" || type === "run.failed" || type === "run.cancelled")) {
    lastRun = { ...lastRun, status: type === "run.completed" ? "completed" : type === "run.failed" ? "failed" : "cancelled",
      error: type === "run.failed" ? String(payload.error ?? "") : null, completedAt: at, updatedAt: at } as Run;
  }
}

function emit(type: ProductEvent["type"], payload: Record<string, unknown>, runId?: string): ProductEvent {
  const event: ProductEvent = {
    id: `guest-event-${++eventSeq}`,
    spaceId: GUEST_SPACE_ID,
    threadId: GUEST_THREAD_ID,
    botId: GUEST_BOT_ID,
    seq: eventSeq,
    type,
    ...(runId ? { runId } : {}),
    createdAt: new Date().toISOString(),
    payload,
  };
  if (runId) trackRun(type, payload, runId, event.createdAt);
  liveEvents = [...liveEvents.slice(-200), event];
  for (const wake of waiters) wake();
  return event;
}

let resumed = false;

/**
 * A message whose answer was still on its way when the page unloaded (reload, closed tab, lost
 * connection) is asked again with the same key as soon as the conversation is shown: the
 * coordinator replays a finished answer or completes the turn, and never runs it twice.
 */
function resumePending() {
  if (resumed || running || !pending) return;
  resumed = true;
  const input = pending, runId = `guest-run-${input.key}`;
  setTimeout(() => {
    if (running || pending !== input) return;
    emit("run.started", { trigger: "user" }, runId);
    void runTurn(input, runId);
  }, 0);
}

async function* subscribe(cursor: number, signal?: AbortSignal): AsyncGenerator<ProductEvent> {
  resumePending();
  let seen = cursor;
  while (!signal?.aborted) {
    const next = liveEvents.filter(event => event.seq > seen);
    for (const event of next) { seen = event.seq; yield event; }
    await new Promise<void>(resolve => {
      const wake = () => { waiters.delete(wake); signal?.removeEventListener("abort", wake); resolve(); };
      waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      // A heartbeat keeps the shell's subscription watchdog satisfied while nothing happens.
      setTimeout(wake, 20_000);
    });
  }
}

const accountCodes = new Set(["guest_session_limit_reached", "guest_prefix_daily_limit", "guest_sessions_limit", "guest_daily_budget_reached"]);

function failureText(code: string): string {
  return ({
    guest_answer_unconfirmed: t`The answer could not be confirmed yet. Try again in a moment; it will not be sent twice.`,
    guest_session_limit_reached: t`You have used the free guest messages. Create a free account to keep chatting.`,
    guest_prefix_daily_limit: t`Guest chat has reached today's limit for your network. Create a free account to keep chatting.`,
    guest_sessions_limit: t`Too many guest chats started from your network. Create a free account or try again later.`,
    guest_daily_budget_reached: t`Guest chat is very busy today. Create a free account or try again tomorrow.`,
    guest_busy: t`The free model is busy right now. Try again in a minute.`,
    guest_request_in_progress: t`Mico is still answering your previous message.`,
    guest_request_invalid: t`This message cannot be sent in guest mode. Try a shorter text message.`,
    guest_answer_timeout: t`Mico is taking longer than usual. Try again; your message will not be sent twice.`,
    guest_connection_lost: t`The connection was interrupted. Try again; your message will not be sent twice.`,
  } as Record<string, string>)[code] ?? t`Guest chat is unavailable right now. Try again later or sign in.`;
}

function setStatus(value: GuestStatus | null) {
  status = value;
  setGuestRemaining(value ? Math.max(0, value.remaining) : null);
}

async function guestStatus(): Promise<GuestStatus | null> {
  if (status) return status;
  statusRead ??= guestApi.status().then(value => { setStatus(value); return value; }, () => null).finally(() => { statusRead = null; });
  return statusRead;
}

/** Failures where asking again with the same key is safe: the coordinator replays, never runs twice. */
const SAME_KEY_RETRY = new Set(["guest_answer_unconfirmed", "guest_answer_timeout", "guest_connection_lost", "guest_session_required", "guest_session_expired", "guest_temporarily_unavailable"]);
const RETRY_DELAY_MS = 1500;

async function attemptTurn(input: GuestPending, runId: string, signal: AbortSignal) {
  if (!(await guestStatus())) setStatus(await guestApi.enter(signal));
  const result = await guestApi.chat(input, text => {
    emit("thread.progress", { text: withoutImages(text), streaming: true }, runId);
  }, signal);
  if (status) setStatus({ ...status, remaining: result.remaining });
  if (result.status !== "completed" || result.content === undefined) throw new GuestChatRequestError("guest_answer_unconfirmed");
  return { ...result, content: result.content };
}

async function runTurn(input: GuestPending, runId: string) {
  const controller = new AbortController();
  running = { runId, controller };
  failedRun = null;
  try {
    let result: Awaited<ReturnType<typeof attemptTurn>>;
    try { result = await attemptTurn(input, runId, controller.signal); }
    catch (error) {
      // One quiet retry with the same key covers an expired guest session, a dropped connection or
      // an answer still being confirmed; the visitor only sees an error if that also fails.
      const code = error instanceof GuestChatRequestError ? error.code : "guest_temporarily_unavailable";
      if (controller.signal.aborted || !SAME_KEY_RETRY.has(code)) throw error;
      if (code === "guest_session_expired" || code === "guest_session_required") setStatus(null);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      controller.signal.throwIfAborted();
      result = await attemptTurn(input, runId, controller.signal);
    }
    history = [...history, { role: "assistant", content: result.content }];
    pending = null;
    save();
    const message = messageOf(history.at(-1)!, history.length - 1);
    emit("thread.message.created", { messageId: message.id, role: "bot", blocks: message.blocks }, runId);
    emit("run.completed", {}, runId);
  } catch (error) {
    if (controller.signal.aborted) { emit("run.cancelled", {}, runId); return; }
    const code = error instanceof GuestChatRequestError ? error.code : "guest_temporarily_unavailable";
    if (code === "guest_session_expired" || code === "guest_session_required") setStatus(null);
    if (code === "guest_session_limit_reached") {
      if (status) setStatus({ ...status, remaining: 0 });
      // Nothing to resume after a reload: the server refused it before any work.
      pending = null;
      save();
    }
    // Refusals before any work keep the message ready to send again; the server never counts it twice.
    if (code !== "guest_session_limit_reached") failedRun = { runId, input };
    emit("run.failed", { error: failureText(code) }, runId);
    if (accountCodes.has(code)) promptGuestAccount("messages");
  } finally {
    if (running?.runId === runId) running = null;
  }
}

function send(input: { text?: string; artifactIds?: string[]; clientNonce?: string }) {
  load();
  const limits = guestLimits();
  if (!limits) throw new GuestAccountRequiredError();
  if (input.artifactIds?.length) throw new GuestAccountRequiredError("files");
  const text = input.text?.trim() ?? "";
  if (!text) throw new ORPCError("BAD_REQUEST", { message: t`Write a message to send.` });
  if (text.length > limits.messageChars) throw new ORPCError("BAD_REQUEST", { message: failureText("guest_request_invalid") });
  if (running) throw new ORPCError("CONFLICT", { message: failureText("guest_request_in_progress") });
  if (status && status.remaining <= 0) { promptGuestAccount("messages"); throw new ORPCError("FORBIDDEN", { message: failureText("guest_session_limit_reached") }); }
  history = [...history, { role: "user", content: text }];
  const request = { key: crypto.randomUUID(), messages: guestHistory(history, limits) };
  pending = request;
  save();
  const message = messageOf(history.at(-1)!, history.length - 1);
  const runId = `guest-run-${request.key}`;
  const created = emit("thread.message.created", {
    messageId: message.id, role: "user", blocks: message.blocks, ...(input.clientNonce ? { clientNonce: input.clientNonce } : {}),
  }, runId);
  emit("run.started", { trigger: "user" }, runId);
  void runTurn(request, runId);
  return { taskId: GUEST_THREAD_ID, runId, seq: created.seq, messageId: message.id };
}

function retry(runId: string) {
  if (running) throw new ORPCError("CONFLICT", { message: failureText("guest_request_in_progress") });
  const failed = failedRun?.runId === runId ? failedRun : pending ? { runId, input: pending } : null;
  if (!failed) throw new ORPCError("NOT_FOUND", { message: t`There is nothing to retry.` });
  emit("run.started", { trigger: "user" }, failed.runId);
  void runTurn(failed.input, failed.runId);
  return { ok: true as const };
}

/** Reads the shell makes on its own; each answers as a new account with nothing set up would. */
const emptyReads: Record<string, (input: unknown) => unknown> = {
  "bots/listArchived": () => [],
  "groups/listArchived": () => [],
  "memory/providerConfig": () => null,
  "models/mycelliosAccount": () => null,
  "engines/codexQuota": () => null,
  "usage/threadContext": () => null,
  "development/projects": () => [],
  "development/requests": () => [],
  "tasks/waits": () => [],
  "threads/pinned": () => ({ threadId: GUEST_THREAD_ID, pins: [] }),
  "pins/mico": () => ({ pins: [] }),
  "routines/mentions": () => [],
  "links/favicon": () => ({ icon: null }),
  "notifications/webPresence": () => ({ ok: true }),
  "threads/markRead": () => ({ ok: true }),
  "threads/queue": () => [],
};

export async function guestCall(path: readonly string[], input: unknown, options: CallOptions = {}): Promise<unknown> {
  const name = path.join("/");
  const value = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "bootstrap": return bootstrap();
    case "me": return me();
    case "spaces/list": return navigation();
    case "bots/list": return [guestBot()];
    case "bots/get": return guestBot();
    case "threads/get": return snapshot();
    case "threads/head": load(); return { threadId: GUEST_THREAD_ID, cursor: eventSeq };
    case "threads/messages": return { threadId: GUEST_THREAD_ID, messages: snapshot().messages, olderCursor: null };
    case "threads/subscribe": load(); return subscribe(typeof value.cursor === "number" ? value.cursor : eventSeq, options.signal);
    case "threads/send": return send(value as Parameters<typeof send>[0]);
    case "threads/retry": return retry(String(value.runId ?? ""));
    case "threads/stop": running?.controller.abort(); return { ok: true };
  }
  const read = emptyReads[name];
  if (read) return read(input);
  if (import.meta.env.DEV) console.info("[guest] account required for", name);
  throw new GuestAccountRequiredError(name);
}

/** Whether the guest has messages left, for the composer; null until the coordinator answers. */
export async function guestRemaining(): Promise<number | null> {
  return (await guestStatus())?.remaining ?? null;
}

// Dev only: guest state lives in this module, so an edit reloads the page instead of keeping two copies.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
