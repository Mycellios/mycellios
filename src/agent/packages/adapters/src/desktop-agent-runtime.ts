import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { DESKTOP_RUN_INTERRUPTED_ERROR, isUncertainDesktopRun } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";
import { DesktopAgentRpc, type AgentRpcMessage } from "./desktop-agent-rpc.js";
import { desktopAgentFrames } from "./desktop-agent-stream.js";
import type { DesktopAgentFrame } from "./desktop-agent-host.js";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import { HOST_COMPUTER_MAX_BYTES } from "./host-computer-protocol.js";
import { desktopModelAccess } from "./desktop-model-access.js";
import { ComputerUpdatingError } from "./computer-errors.js";
import { desktopAgentSegmentId } from "./desktop-agent-segment.js";

const RESULT_DELIVERY_ATTEMPTS = 3;
type DesktopImage = NonNullable<AgentRunRequest["currentTurnImages"]>[number];

/** Approximate the JSON wire without expanding Uint8Array image bytes into an object. */
function requestBytesApprox(request: AgentRunRequest): number {
  const plain = {
    ...request,
    currentTurnImages: undefined,
    history: request.history.map((message) => ({ ...message, images: undefined })),
  };
  let bytes = Buffer.byteLength(JSON.stringify(plain));
  const images = [
    ...(request.currentTurnImages ?? []),
    ...request.history.flatMap((message) => message.images ?? []),
  ];
  for (const image of images) bytes += Math.ceil(image.data.byteLength * 4 / 3) + 256;
  return bytes;
}

/** Downscale an attachment so the Desktop bridge can carry it without losing the turn. */
async function shrinkDesktopImage(image: DesktopImage): Promise<DesktopImage> {
  try {
    const { default: sharp } = await import("sharp");
    const input = Buffer.from(image.data);
    const resized = sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 });
    const output = await resized.toBuffer();
    if (output.byteLength >= input.byteLength) return image;
    return { ...image, mimeType: "image/jpeg", data: output };
  } catch {
    return image;
  }
}

/**
 * The Desktop bridge caps one request at HOST_COMPUTER_MAX_BYTES, while the model
 * image budget allows more bytes than that. Compress images first, then drop only
 * the oldest history images, so a large screenshot cannot abort the whole turn.
 */
async function fitDesktopRequest(request: AgentRunRequest): Promise<AgentRunRequest> {
  const limit = HOST_COMPUTER_MAX_BYTES - 256 * 1024;
  if (requestBytesApprox(request) <= limit) return request;
  const currentTurnImages = request.currentTurnImages
    ? await Promise.all(request.currentTurnImages.map(shrinkDesktopImage))
    : undefined;
  let history = request.history.map((message) => ({ ...message }));
  for (const message of history) {
    if (message.images?.length) message.images = await Promise.all(message.images.map(shrinkDesktopImage));
  }
  let prepared: AgentRunRequest = { ...request, currentTurnImages, history };
  for (let index = 0; index < history.length && requestBytesApprox(prepared) > limit; index += 1) {
    if (!history[index]?.images?.length) continue;
    history = history.map((message, position) =>
      position === index ? { ...message, images: undefined } : message,
    );
    prepared = { ...prepared, history };
  }
  if (requestBytesApprox(prepared) > limit) {
    throw new Error(
      "This turn is too large for the Desktop bridge even after compressing attachments. Remove an attachment or start a new chat.",
    );
  }
  return prepared;
}

function retryableResultDelivery(error: unknown): boolean {
  if (error instanceof ComputerUpdatingError || !(error instanceof Error) || error.name === "AbortError") return false;
  return [
    "Desktop execution interrupted",
    "Desktop execution disconnected",
    "Desktop executor unavailable",
    "Desktop operation interrupted",
    "Desktop delivery was interrupted",
    "Desktop response disconnected",
    "Local computer disconnected",
  ].some((prefix) => error.message === prefix || error.message.startsWith(prefix));
}

async function deliverAgentResult(
  send: () => Promise<void>,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= RESULT_DELIVERY_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Desktop execution aborted");
    try {
      await send();
      if (attempt > 1) getLogger().info("desktop.agent.result_acknowledged", {
        "run.id": runId, "desktop.attempt": attempt, "desktop.elapsed_ms": Date.now() - started,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!retryableResultDelivery(error) || attempt === RESULT_DELIVERY_ATTEMPTS) break;
      getLogger().warn("desktop.agent.result_unacknowledged", {
        "run.id": runId, "desktop.attempt": attempt, "desktop.elapsed_ms": Date.now() - started,
      });
      await delay(250, undefined, { signal });
    }
  }
  throw lastError;
}

export class DesktopAgentRuntime implements AgentRuntime {
  private active = new Map<string, AbortController>();
  constructor(private readonly options: {
    fallback: AgentRuntime;
    select(context: AdapterContext): Promise<{ available: boolean; preferred: boolean }>;
    transport(request: HostComputerRequest, context: AdapterContext): Promise<Response>;
  }) {}
  describe() { return this.options.fallback.describe(); }
  async abort(runId: string) { this.active.get(runId)?.abort(); await this.options.fallback.abort(runId); }
  async *run(request: AgentRunRequest, partial?: Partial<AdapterContext>): AsyncIterable<AgentRuntimeEvent> {
    if (!partial?.userId || !partial.spaceId || !partial.signal) throw Error("Desktop execution requires an authenticated run");
    const context = { ...partial, botId: request.botId, runId: request.runId } as AdapterContext;
    // The approval judge is a server authority, not another Desktop task waiting for
    // a runtime slot held by the very operation it is deciding whether to admit.
    if (request.usageOperationKind === "setup" && !request.tools.length || request.script) { yield* this.options.fallback.run(request, context); return; }
    if (context.cloudWorkspace) {
      yield* this.options.fallback.run({
        ...request,
        instructions: `${request.instructions}\nThis turn uses a server workspace separate from Desktop. For work that requires files only on the PC, explain which files are needed.`,
      }, context);
      return;
    }
    const route = await this.options.select(context);
    if (!route.available) {
      // The executor also supplies resumeToolResult on fresh turns. Only an
      // actual checkpoint or project binding requires the original Desktop.
      if (route.preferred && (context.projectSessionId || request.resumeFromCheckpoint || request.turnCheckpoint)) {
        throw Error("This task is bound to your Desktop. Reconnect the PC to resume it.");
      }
      if (route.preferred) {
        // Local-first: never move a Desktop turn to the cloud without consent.
        // The user can switch this Mico's computer explicitly from its settings.
        throw Error("Your Desktop is offline. Reconnect it to continue. This Mico did not move to the cloud; switch its computer explicitly if you want to run it there.");
      }
      yield* this.options.fallback.run(request, context);
      return;
    }
    if (this.active.has(request.runId)) throw Error("Desktop run already active");
    const controller = new AbortController(), sessionId = randomUUID();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    this.active.set(request.runId, controller);
    const owned = { ...context, signal };
    let callbackError: unknown;
    const rpc = new DesktopAgentRpc(async (message: AgentRpcMessage) => {
      const post = async () => {
        const response = await this.options.transport({ method: "agentMessage", botId: request.botId, runId: request.runId, sessionId, message, ...(context.projectSessionId ? { projectSessionId: context.projectSessionId } : {}) }, owned);
        for await (const _ of desktopAgentFrames(response, signal, "callback")) { /* consume the complete acknowledgement */ }
      };
      if (message.kind !== "result") { await post(); return; }
      await deliverAgentResult(post, request.runId, signal);
    });
    const capture = request.onCheckpoint;
    const cleanup = new Set<() => void>();
    const nativeEngine = Boolean(request.agentEngine && request.agentEngine !== "pi");
    const trustedUsage: AgentRuntimeEvent[] = [];
    const accounting = { runId: request.runId, userId: context.userId, operationKind: request.usageOperationKind, onUsage: request.onUsage, push: (event: AgentRuntimeEvent) => trustedUsage.push(event) };
    const encodeRequest = (input: AgentRunRequest = request) => rpc.encode({ ...input,
      // A native client may not self-report paid usage or bypass a reservation. Provider
      // credentials, credit observers and genuine usage stay at the cloud model boundary.
      onUsage: async () => undefined,
      // A native engine runs its own model from its local configuration; handing it
      // the account model made every native run fail as unavailable.
      model: nativeEngine ? request.model : desktopModelAccess(request.model, signal, cleanup, accounting),
      ...(request.resolveModel ? { resolveModel: async (provider: string, id: string) => nativeEngine ? request.resolveModel!(provider, id) : desktopModelAccess(await request.resolveModel!(provider, id), signal, cleanup, accounting) } : {}),
      ...(request.resolveFallbackModel ? { resolveFallbackModel: async (provider: string, id: string, connection?: string) => nativeEngine ? request.resolveFallbackModel!(provider, id, connection) : desktopModelAccess(await request.resolveFallbackModel!(provider, id, connection), signal, cleanup, accounting) } : {}),
      ...(capture ? { onCheckpoint: (blob: string, id: string) => capture(() => blob, id) } : {}),
    });
    const callbacks = new Set<Promise<void>>();
    let completion: Extract<AgentRuntimeEvent, { type: "done" }> | undefined;
    let nativeUsage = false;
    let dispatched = false;
    let receivedFailure = false;
    try {
      const wire = encodeRequest(await fitDesktopRequest(request));
      dispatched = true;
      const response = await this.options.transport({ method: "agentRun", botId: request.botId, runId: request.runId, sessionId, segmentId: desktopAgentSegmentId(request), request: wire, ...(context.projectSessionId ? { projectSessionId: context.projectSessionId } : {}) }, owned);
      // No fallback after dispatch: a lost response can conceal real local effects.
      for await (const raw of desktopAgentFrames(response, signal)) {
        for (const usage of trustedUsage.splice(0)) yield usage;
        const frame = raw as DesktopAgentFrame;
        if (frame.kind === "rpc") {
          const task = rpc.accept(frame.message).catch(error => { callbackError = error; controller.abort(); }).finally(() => callbacks.delete(task));
          callbacks.add(task);
        } else if (frame.kind === "failure") {
          const failure = rpc.decode(frame.value);
          receivedFailure = true;
          throw failure;
        }
        else if (frame.kind === "event") {
          const event = rpc.decode(frame.value) as AgentRuntimeEvent;
          if (!event || typeof event.type !== "string" || completion) throw Error("Invalid Desktop agent event");
          if (event.type === "usage") {
            if (request.agentEngine && request.agentEngine !== "pi" && !nativeUsage) {
              nativeUsage = true;
              const usage = { type: "usage" as const, provider: request.model.provider, model: request.model.id, inputTokens: null, outputTokens: null, costUsd: null, usageSource: "native-cli" };
              await request.onUsage?.(usage); yield { ...usage, ...(request.onUsage ? { accounted: true } : {}) };
            }
            continue; // Untrusted host token/cost numbers are never billed.
          }
          if (event.type === "done") completion = event;
          else yield event;
        } else throw Error("Invalid Desktop agent stream");
      }
      await Promise.all(callbacks);
      if (callbackError) throw callbackError;
      signal.throwIfAborted();
      for (const usage of trustedUsage.splice(0)) yield usage;
      if (!completion) throw Error("Desktop agent did not finish; check existing results before retrying");
      yield completion;
    } catch (error) {
      const failure = callbackError ?? error;
      if (failure instanceof ComputerUpdatingError) {
        context.onComputerUpdate?.(failure.dispatched);
      } else if (dispatched && (!receivedFailure || callbackError) && !context.signal.aborted &&
        !(failure instanceof Error && isUncertainDesktopRun(failure.message))) {
        // An unconfirmed transport or protocol failure can hide local side effects.
        throw Error(DESKTOP_RUN_INTERRUPTED_ERROR, { cause: failure });
      }
      throw failure;
    }
    finally { controller.abort(); for (const cancel of cleanup) cancel(); cleanup.clear(); rpc.close(); await Promise.allSettled(callbacks); this.active.delete(request.runId); }
  }
}
