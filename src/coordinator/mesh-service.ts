import { isKokoroDeployment } from "../contracts/speech.js";
import { DECISION_DEADLINE_MS, DECISION_MODEL, isDecisionDeployment, parseDecisionRequest, verifiedDecisionEnvelope } from "../contracts/decision.js";
import { EMBEDDING_MODEL, isEmbeddingDeployment, parseEmbeddingRequest, verifiedEmbeddingEnvelope } from "../contracts/embedding.js";
import { replicaOutputByteLimit, validateSpeechCompletion } from "./speech-completion.js";
import { EventEmitter } from "node:events";
import type {
  ChatCompletionRequest,
  CompletionResult,
  ExecutionRouteDecisionRecord,
  JobPayload,
  NetworkExecutionTrace,
  ScheduledRoute,
  TokenEvent,
  WorkerEnvelope,
} from "../contracts/types.js";
import { AsyncQueue } from "../core/async-queue.js";
import { newId } from "../core/ids.js";
import { modelRequestTimeout } from "../core/model-request-deadline.js";
import { estimateInputTokens, inputHashForRequest } from "../core/request.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import { Scheduler } from "../scheduler/scheduler.js";
import type { MeshStore, StoredJob } from "../storage/store.js";
import type { WorkerHub } from "./worker-hub.js";
import type { RuntimeTransportSnapshot } from "./worker-hub.js";
import {
  buildNetworkExecutionTrace,
  networkTraceBoundaryKeys,
} from "../telemetry/network-execution-trace.js";

export type JobStreamEvent =
  | { type: "accepted"; jobId: string; sessionId: string; route: ScheduledRoute }
  | {
      type: "progress";
      phase: "waiting_first_token" | "recovering";
      message: string;
      attempt: number;
      workerId?: string;
      nodeId?: string;
      recoveryMode?: "prompt-replay" | "deterministic-prefix-replay";
    }
  | { type: "token"; token: TokenEvent }
  | { type: "completed"; result: CompletionResult }
  | { type: "failed"; code: string; message: string };

export interface JobHandle {
  jobId: string;
  sessionId: string;
  events: AsyncIterable<JobStreamEvent>;
}

interface RuntimeJob {
  request: ChatCompletionRequest;
  route: ScheduledRoute;
  routePlan: ScheduledRoute[];
  routeDecision: ExecutionRouteDecisionRecord;
  routeIndex: number;
  promptCheckpoint: PromptCheckpoint;
  queue: AsyncQueue<JobStreamEvent>;
  output: string;
  outputTokens: string[];
  outputBytes: number;
  nextTokenIndex: number;
  replayPrefix: { tokens: string[]; nextIndex: number } | null;
  recoveryMode: "none" | "prompt-replay" | "deterministic-prefix-replay";
  replayedTokenEvents: number;
  timeout: NodeJS.Timeout;
  leaseTimer: NodeJS.Timeout | null;
  firstTokenTimer: NodeJS.Timeout | null;
  attempt: number;
  attemptStartedAt: number;
  attemptTransportStart: RuntimeTransportSnapshot[];
  attemptBoundaryKeys: Set<string>;
}

interface TransportUsageInterval {
  jobId: string;
  startedAt: number;
  endedAt: number;
  boundaryKeys: Set<string>;
}

interface PromptCheckpoint {
  request: ChatCompletionRequest;
  requestHash: string;
  inputTokens: number;
}

const PRETOKEN_DEGRADATION_CODES = new Set([
  "adapter_error",
  "first_token_timeout",
  "pipeline_stage_disconnected",
  "worker_disconnected",
  "worker_unreachable",
  "lease_accept_timeout",
]);

export interface MeshServiceOptions {
  firstTokenTimeoutMs?: number;
  modelRequestTimeoutsMs?: Readonly<Record<string, number>> | undefined;
}

interface MeshServiceEvents {
  degraded: [{ jobId: string; model: string; code: string; workerId: string | null }];
  healthy: [{ jobId: string; model: string; workerId: string | null }];
}

export class MeshService extends EventEmitter<MeshServiceEvents> {
  private eventTail: Promise<void> = Promise.resolve();
  private readonly eventErrors: unknown[] = [];

  private enqueueEvent(action: () => Promise<void>): Promise<void> {
    this.eventTail = this.eventTail.then(action).catch(error => {
      this.eventErrors.push(error);
      console.error("mycellios_runtime_event_failed", error);
    });
    return this.eventTail;
  }

  async drainEvents(): Promise<void> {
    // Include events enqueued while the previous event was finishing.
    let tail: Promise<void>;
    do { tail = this.eventTail; await tail; } while (tail !== this.eventTail);
    if (this.eventErrors.length) throw this.eventErrors.shift();
  }

  private readonly runtimes = new Map<string, RuntimeJob>();
  private readonly activeSessions = new Map<string, string>();
  private readonly recentTransportUsage: TransportUsageInterval[] = [];

  static async create(store: MeshStore, scheduler: Scheduler, hub: WorkerHub, requestTimeoutMs: number, options: MeshServiceOptions = {}): Promise<MeshService> {
    const service = new MeshService(store, scheduler, hub, requestTimeoutMs, options);
    await service.recoverOrphanedJobs();
    return service;
  }

  private constructor(
    readonly store: MeshStore,
    readonly scheduler: Scheduler,
    readonly hub: WorkerHub,
    private readonly requestTimeoutMs: number,
    private readonly options: MeshServiceOptions = {},
  ) {
    super();
    if (typeof hub.subscribeWorkerEvents === "function") {
      hub.subscribeWorkerEvents({
        envelope: envelope => this.enqueueEvent(() => this.handleWorkerEnvelope(envelope)),
        disconnect: workerId => this.enqueueEvent(() => this.handleWorkerDisconnect(workerId)),
      });
    } else {
      // Lightweight test hubs expose EventEmitter without production transport.
      hub.on("envelope", envelope => { void this.enqueueEvent(() => this.handleWorkerEnvelope(envelope)); });
      hub.on("disconnect", workerId => { void this.enqueueEvent(() => this.handleWorkerDisconnect(workerId)); });
    }
  }

  async submit(
    request: ChatCompletionRequest,
    requestedSessionId?: string,
    idempotencyKey?: string,
  ): Promise<JobHandle> {
    const sessionId = requestedSessionId ?? request.session_id ?? newId("ses");
    const activeJobId = this.activeSessions.get(sessionId);
    if (activeJobId) {
      throw new MeshServiceError(
        "session_busy",
        `Session already has an active request: ${activeJobId}`,
        409,
      );
    }
    const stableRequest = cloneRequest(request);
    const jobId = newId("job");
    // Reserve synchronously before the first database wait.
    this.activeSessions.set(sessionId, jobId);
    try {
    const idempotencyRequestHash = idempotencyKey ? inputHashForRequest(stableRequest) : null;
    if (idempotencyKey) {
      const existing = (await this.store.getIdempotentJob(idempotencyKey));
      if (existing) {
        const code = existing.requestHash === idempotencyRequestHash
          ? "idempotency_replayed"
          : "idempotency_key_reused";
        throw new MeshServiceError(
          code,
          `Idempotency key is already bound to job ${existing.jobId}`,
          409,
        );
      }
    }
    const queue = new AsyncQueue<JobStreamEvent>();
    // Atomic long-context embeddings have their own bounded execution budget.
    // Preserve the caller's shorter deadline and all other models' timeouts.
    const deadlineCeiling = stableRequest.model === DECISION_MODEL ? DECISION_DEADLINE_MS : stableRequest.model === EMBEDDING_MODEL ? 300_000 : modelRequestTimeout(stableRequest.model, this.options.modelRequestTimeoutsMs, this.requestTimeoutMs);
    const deadlineMs = Math.min(request.deadline_ms ?? deadlineCeiling, deadlineCeiling);
    (await this.store.database.transaction(async () => {
      (await this.store.createJob({
        id: jobId,
        sessionId,
        model: stableRequest.model,
        workloadClass: stableRequest.workload_class ?? "interactive",
        deadlineAt: Date.now() + deadlineMs,
      }));
      if (idempotencyKey) {
        (await this.store.bindIdempotencyKey(idempotencyKey, idempotencyRequestHash!, jobId));
      }
    }));

    const routeOptions = routeOptionsForRequest(stableRequest, this.hub.connectedWorkerIds());
    const routePlan = (await this.scheduler.selectRoutePlan(stableRequest, sessionId, {
      ...routeOptions,
      allowPipeline: false,
      maxStandbyRoutes: 2,
    }));
    if (!routePlan) {
      (await this.store.setJobStatus(jobId, "failed", "no_capacity"));
      const decision = (await this.scheduler.selectExecutionRouteDecision(stableRequest, sessionId, {
        ...routeOptions,
        allowPipeline: false,
      }));
      const privacyFailure = privacyFailureFor(decision.reasons);
      if (privacyFailure) {
        (await this.store.setJobStatus(jobId, "failed", privacyFailure.code));
        throw new MeshServiceError(privacyFailure.code, privacyFailure.message, 503);
      }
      throw new MeshServiceError(
        "no_capacity",
        `No healthy replica is currently available for ${stableRequest.model}`,
        503,
      );
    }
    const route = routePlan.primary;

    const timeout = setTimeout(
      () => this.enqueueEvent(async () => (await this.failRuntime(jobId, "deadline_exceeded", "The distributed request timed out"))),
      deadlineMs,
    );
    const attemptStartedAt = Date.now();
    const runtime: RuntimeJob = {
      request: stableRequest,
      route,
      routePlan: [routePlan.primary, ...routePlan.standbys],
      routeDecision: structuredClone(routePlan.decision),
      routeIndex: 0,
      promptCheckpoint: createPromptCheckpoint(stableRequest),
      queue,
      output: "",
      outputTokens: [],
      outputBytes: 0,
      nextTokenIndex: 0,
      replayPrefix: null,
      recoveryMode: "none",
      replayedTokenEvents: 0,
      timeout,
      leaseTimer: null,
      firstTokenTimer: null,
      attempt: 1,
      attemptStartedAt,
      attemptTransportStart: this.captureRuntimeTransportSnapshot(),
      attemptBoundaryKeys: networkTraceBoundaryKeys(
        route,
        (await this.store.listWorkers()),
      ),
    };
    this.runtimes.set(jobId, runtime);
    this.activeSessions.set(sessionId, jobId);
    queue.push({ type: "accepted", jobId, sessionId, route });
    (await this.dispatch(jobId, runtime));

    return { jobId, sessionId, events: queue };
    } finally {
      if (!this.runtimes.has(jobId) && this.activeSessions.get(sessionId) === jobId) {
        this.activeSessions.delete(sessionId);
      }
    }
  }

  /**
   * Cancels an orphaned request only when a reconnect repeats the exact same
   * immutable prompt in the same session. A genuinely different concurrent
   * message keeps the normal session_busy protection.
   */
  async cancelMatchingActiveSession(
    request: ChatCompletionRequest,
    requestedSessionId?: string,
  ): Promise<string | null> {
    const sessionId = requestedSessionId ?? request.session_id;
    if (!sessionId) return null;
    const activeJobId = this.activeSessions.get(sessionId);
    if (!activeJobId) return null;
    const runtime = this.runtimes.get(activeJobId);
    if (!runtime) return null;
    if (inputHashForRequest(cloneRequest(request)) !== runtime.promptCheckpoint.requestHash) {
      return null;
    }
    return (await this.cancel(activeJobId)) ? activeJobId : null;
  }

  async hasCapacity(request: ChatCompletionRequest, requestedSessionId?: string): Promise<boolean> {
    const sessionId = requestedSessionId ?? request.session_id ?? newId("capacity");
    return (await this.scheduler.selectRoutePlan(cloneRequest(request), sessionId, {
      ...routeOptionsForRequest(request, this.hub.connectedWorkerIds()),
      allowPipeline: false,
      maxStandbyRoutes: 2,
    })) !== null;
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = (await this.store.getJob(jobId));
    if (!job) return false;
    const runtime = this.runtimes.get(jobId);
    if (!runtime) return false;
    if (job.workerId) this.hub.send(job.workerId, "task.cancel", { jobId });
    (await this.store.setJobStatus(jobId, "cancelled", "cancelled_by_client"));
    runtime.queue.push({ type: "failed", code: "cancelled", message: "Request cancelled" });
    (await this.finishRuntime(jobId));
    return true;
  }

  private async dispatch(jobId: string, runtime: RuntimeJob, promote = false): Promise<void> {
    if (
      inputHashForRequest(runtime.promptCheckpoint.request) !==
      runtime.promptCheckpoint.requestHash
    ) {
      (await this.failRuntime(
        jobId,
        "prompt_checkpoint_corrupt",
        "The immutable prompt checkpoint failed its integrity check",
      ));
      return;
    }
    const stage = runtime.route.stages[0];
    if (!stage) {
      (await this.failRuntime(jobId, "empty_route", "Scheduler produced an empty route"));
      return;
    }
    // Planning is not an admission grant. Recheck the immutable request and
    // exact route against current owner/capacity/evidence before offering work.
    const queued = await this.store.getJob(jobId);
    if (!queued || queued.deadlineAt <= Date.now()) {
      await this.failRuntime(jobId, "deadline_exceeded", "The request expired before dispatch");
      return;
    }
    if (!(await this.scheduler.isRouteCurrentlyEligible(runtime.request, queued.sessionId, runtime.route, {
      ...routeOptionsForRequest(runtime.request, this.hub.connectedWorkerIds()), allowPipeline: false,
    }))) {
      await this.retryOrFail(jobId, "route_no_longer_eligible", "The planned route is no longer eligible");
      return;
    }
    const leaseId = newId("lea");
    if (promote) (await this.store.promoteJobRoute(jobId, runtime.route, leaseId));
    else (await this.store.setJobRoute(jobId, runtime.route, leaseId));
    const job = (await this.store.getJob(jobId));
    if (!job) return;
    const payload: JobPayload = {
      jobId,
      leaseId,
      modelDigest: stage.modelDigest,
      deadlineAt: job.deadlineAt,
      request: cloneRequest(runtime.promptCheckpoint.request),
    };
    if (!this.hub.send(stage.workerId, "lease.offer", payload)) {
      (await this.retryOrFail(jobId, "worker_unreachable"));
      return;
    }
    if (runtime.leaseTimer) clearTimeout(runtime.leaseTimer);
    runtime.leaseTimer = setTimeout(() => this.enqueueEvent(async () => (await this.retryOrFail(jobId, "lease_accept_timeout"))), 3_000);
  }

  private async handleWorkerEnvelope(envelope: WorkerEnvelope): Promise<void> {
    switch (envelope.type) {
      case "lease.accept":
        (await this.onLeaseAccepted(envelope));
        break;
      case "lease.reject":
        (await this.onLeaseRejected(envelope));
        break;
      case "task.token":
        (await this.onToken(envelope));
        break;
      case "task.complete":
        (await this.onComplete(envelope));
        break;
      case "task.fail":
        (await this.onFailure(envelope));
        break;
    }
  }

  private async onLeaseAccepted(envelope: WorkerEnvelope): Promise<void> {
    const payload = envelope.payload as { jobId: string; leaseId: string };
    const job = (await this.validJobEnvelope(envelope.workerId, payload.jobId, payload.leaseId));
    if (job) {
      const runtime = this.runtimes.get(job.id);
      if (runtime?.leaseTimer) clearTimeout(runtime.leaseTimer);
      if (runtime) runtime.leaseTimer = null;
      (await this.store.setJobStatus(job.id, "running"));
      if (runtime) {
        if (runtime.firstTokenTimer) clearTimeout(runtime.firstTokenTimer);
        const firstTokenTimeoutMs = (await this.firstTokenTimeoutFor(job.id, runtime));
        runtime.queue.push({
          type: "progress",
          phase: "waiting_first_token",
          message: "Route accepted. Waiting for the first model token.",
          attempt: runtime.attempt,
          workerId: envelope.workerId,
        });
        runtime.firstTokenTimer = setTimeout(() => this.enqueueEvent(async () => {
          const active = this.runtimes.get(job.id);
          if (!active || (active.nextTokenIndex > 0 && !active.replayPrefix)) return;
          (await this.retryOrFail(
            job.id,
            "first_token_timeout",
            `The selected route produced no first token within ${firstTokenTimeoutMs} ms`,
          ));
        }), firstTokenTimeoutMs);
      }
    }
  }

  private async onLeaseRejected(envelope: WorkerEnvelope): Promise<void> {
    const payload = envelope.payload as { jobId: string; leaseId: string; reason?: string };
    if (!(await this.validJobEnvelope(envelope.workerId, payload.jobId, payload.leaseId))) return;
    (await this.retryOrFail(payload.jobId, payload.reason ?? "lease_rejected"));
  }

  private async onToken(envelope: WorkerEnvelope): Promise<void> {
    const payload = envelope.payload as {
      jobId: string;
      leaseId: string;
      index: number;
      text: string;
    };
    const job = (await this.validJobEnvelope(envelope.workerId, payload.jobId, payload.leaseId));
    const runtime = this.runtimes.get(payload.jobId);
    if (!job || !runtime) return;
    if (runtime.leaseTimer) clearTimeout(runtime.leaseTimer);
    runtime.leaseTimer = null;
    if (runtime.firstTokenTimer) clearTimeout(runtime.firstTokenTimer);
    runtime.firstTokenTimer = null;
    if (runtime.replayPrefix) {
      const expected = runtime.replayPrefix.tokens[runtime.replayPrefix.nextIndex];
      if (payload.index !== runtime.replayPrefix.nextIndex || payload.text !== expected) {
        (await this.failRuntime(
          payload.jobId,
          "replay_prefix_mismatch",
          "The exact-revision standby diverged while replaying the committed output prefix",
        ));
        return;
      }
      runtime.replayPrefix.nextIndex += 1;
      if (runtime.replayPrefix.nextIndex === runtime.replayPrefix.tokens.length) {
        runtime.replayPrefix = null;
      }
      return;
    }
    const chunkBytes = Buffer.byteLength(payload.text, "utf8");
    const deployment = (await this.store.getWorker(envelope.workerId))?.capabilities.deployments.find((d) => d.deploymentId === job.deploymentId);
    const maxOutputBytes = replicaOutputByteLimit(deployment, runtime.request.max_tokens);
    if (
      payload.index !== runtime.nextTokenIndex ||
      typeof payload.text !== "string" ||
      chunkBytes > 65_536 ||
      runtime.outputBytes + chunkBytes > maxOutputBytes
    ) {
      (await this.failRuntime(payload.jobId, "invalid_stream", "Worker sent an invalid token sequence"));
      return;
    }
    runtime.nextTokenIndex += 1;
    runtime.output += payload.text;
    runtime.outputTokens.push(payload.text);
    runtime.outputBytes += chunkBytes;
    if (runtime.nextTokenIndex === 1) (await this.store.setJobStatus(payload.jobId, "streaming"));
    runtime.queue.push({ type: "token", token: { index: payload.index, text: payload.text } });
  }

  private async onComplete(envelope: WorkerEnvelope): Promise<void> {
    const result = envelope.payload as CompletionResult;
    const job = (await this.validJobEnvelope(
      envelope.workerId,
      result.jobId,
      result.leaseId,
    ));
    const runtime = this.runtimes.get(result.jobId);
    if (!job || !runtime) return;
    if (runtime.replayPrefix) {
      (await this.failRuntime(
        job.id,
        "replay_prefix_incomplete",
        "The exact-revision standby completed before reproducing the committed output prefix",
      ));
      return;
    }
    const validation = (await this.validateCompletion(job, runtime, result));
    if (!validation.ok) {
      (await this.failRuntime(job.id, "invalid_completion", validation.reason));
      return;
    }
    const observedUntil = Date.now();
    const endTransports = this.captureRuntimeTransportSnapshot();
    const contendedBoundaryKeys = this.contendedBoundaryKeys(
      job.id,
      runtime.attemptStartedAt,
      observedUntil,
      runtime.attemptBoundaryKeys,
    );
    const networkTrace = (await this.buildCompletionNetworkTrace(
      job.id,
      runtime,
      observedUntil,
      endTransports,
      contendedBoundaryKeys,
    ));
    (await this.store.database.transaction(async () => {
      (await this.store.completeJob(job.id, result.metrics));
      (await this.store.saveSession(job.sessionId, job.model, runtime.route));
    }));
    runtime.queue.push({
      type: "completed",
      result: { ...result, text: runtime.output, networkTrace, recovery: {
        mode: runtime.recoveryMode,
        attempts: runtime.attempt,
        replayedTokenEvents: runtime.replayedTokenEvents,
      }, privacy: executionPrivacyTrace(runtime.request) },
    });
    this.emit("healthy", {
      jobId: job.id,
      model: job.model,
      workerId: job.workerId,
    });
    (await this.finishRuntime(job.id));
  }

  private async onFailure(envelope: WorkerEnvelope): Promise<void> {
    const payload = envelope.payload as {
      jobId: string;
      leaseId: string;
      code?: string;
      message?: string;
    };
    if (!(await this.validJobEnvelope(envelope.workerId, payload.jobId, payload.leaseId))) return;
    const runtime = this.runtimes.get(payload.jobId);
    (await this.retryOrFail(payload.jobId, payload.code ?? "worker_failed", payload.message));
  }

  private async handleWorkerDisconnect(workerId: string): Promise<void> {
    const handledJobs = new Set<string>();
    for (const job of (await this.store.listActiveJobsForWorker(workerId))) {
      handledJobs.add(job.id);
      const runtime = this.runtimes.get(job.id);
      if (runtime) (await this.retryOrFail(job.id, "worker_disconnected", "Worker disconnected after streaming began"));
    }
    const disconnectedWorker = (await this.store.getWorker(workerId));
    const disconnectedNodeId = disconnectedWorker?.capabilities.distributedExecutor?.nodeId;
    if (!disconnectedNodeId) return;
    for (const [jobId, runtime] of this.runtimes) {
      if (handledJobs.has(jobId)) continue;
      const job = (await this.store.getJob(jobId));
      if (!job?.workerId || !job.deploymentId) continue;
      const routeWorker = (await this.store.getWorker(job.workerId));
      const deployment = routeWorker?.capabilities.deployments.find(
        (candidate) => candidate.deploymentId === job.deploymentId,
      );
      const affectedStage = deployment?.execution?.stages?.find(
        (stage) => stage.nodeId === disconnectedNodeId,
      );
      if (!affectedStage) continue;
      const message = `${affectedStage.deviceName} (${disconnectedNodeId}) disconnected from the distributed pipeline`;
      runtime.queue.push({
        type: "progress",
        phase: "recovering",
        message,
        attempt: runtime.attempt,
        workerId,
        nodeId: disconnectedNodeId,
      });
      (await this.retryOrFail(jobId, "pipeline_stage_disconnected", message));
    }
  }

  private async retryOrFail(jobId: string, reason: string, failureMessage?: string): Promise<void> {
    const job = (await this.store.getJob(jobId));
    const runtime = this.runtimes.get(jobId);
    if (!job || !runtime) return;
    if (runtime.leaseTimer) clearTimeout(runtime.leaseTimer);
    runtime.leaseTimer = null;
    if (runtime.firstTokenTimer) clearTimeout(runtime.firstTokenTimer);
    runtime.firstTokenTimer = null;
    const replayingCommittedPrefix = runtime.nextTokenIndex > 0;
    if (replayingCommittedPrefix && !Number.isSafeInteger(runtime.request.seed)) {
      (await this.failRuntime(
        jobId,
        reason,
        "Streaming already began and exact replay requires an explicit deterministic seed",
      ));
      return;
    }
    const previousWorkerId = job.workerId;
    if (previousWorkerId) this.hub.send(previousWorkerId, "task.cancel", { jobId });
    this.recordTransportUsage(jobId, runtime, Date.now());
    while (runtime.routeIndex + 1 < runtime.routePlan.length) {
      runtime.routeIndex += 1;
      const route = runtime.routePlan[runtime.routeIndex]!;
      if (!route.stages.every((stage) => this.hub.isConnected(stage.workerId))) continue;
      if (!(await this.scheduler.isRouteCurrentlyEligible(
        runtime.request,
        job.sessionId,
        route,
        { ...routeOptionsForRequest(runtime.request, this.hub.connectedWorkerIds()), allowPipeline: false },
      ))) continue;
      runtime.route = route;
      runtime.replayPrefix = replayingCommittedPrefix
        ? { tokens: [...runtime.outputTokens], nextIndex: 0 }
        : null;
      runtime.recoveryMode = replayingCommittedPrefix
        ? "deterministic-prefix-replay"
        : "prompt-replay";
      if (replayingCommittedPrefix) runtime.replayedTokenEvents += runtime.outputTokens.length;
      selectFallbackDecision(runtime.routeDecision, route);
      runtime.attempt += 1;
      runtime.attemptStartedAt = Date.now();
      runtime.attemptTransportStart = this.captureRuntimeTransportSnapshot();
      runtime.attemptBoundaryKeys = networkTraceBoundaryKeys(
        route,
        (await this.store.listWorkers()),
      );
      runtime.queue.push({
        type: "progress",
        phase: "recovering",
        message: replayingCommittedPrefix
          ? `Replaying ${runtime.outputTokens.length} committed token event(s) on an exact-revision standby; duplicate output is suppressed.`
          : "The route failed before token zero. Retrying on an exact-model standby.",
        attempt: runtime.attempt,
        recoveryMode: replayingCommittedPrefix
          ? "deterministic-prefix-replay"
          : "prompt-replay",
        ...(previousWorkerId ? { workerId: previousWorkerId } : {}),
      });
      (await this.dispatch(jobId, runtime, true));
      return;
    }
    (await this.failRuntime(
      jobId,
      reason,
      failureMessage ?? (replayingCommittedPrefix
        ? "No exact-model preplanned standby remains for deterministic prefix replay"
        : "No exact-model preplanned standby remains for prompt recomputation"),
    ));
  }

  private async failRuntime(jobId: string, code: string, message = code): Promise<void> {
    const job = (await this.store.getJob(jobId));
    const runtime = this.runtimes.get(jobId);
    if (!job || !runtime) return;
    if (job.workerId) this.hub.send(job.workerId, "task.cancel", { jobId });
    (await this.store.setJobStatus(jobId, code === "deadline_exceeded" ? "expired" : "failed", code));
    runtime.queue.push({ type: "failed", code, message });
    if (runtime.nextTokenIndex === 0 && PRETOKEN_DEGRADATION_CODES.has(code)) {
      this.emit("degraded", {
        jobId,
        model: job.model,
        code,
        workerId: job.workerId,
      });
    }
    (await this.finishRuntime(jobId));
  }

  private async finishRuntime(jobId: string): Promise<void> {
    const runtime = this.runtimes.get(jobId);
    if (!runtime) return;
    clearTimeout(runtime.timeout);
    if (runtime.leaseTimer) clearTimeout(runtime.leaseTimer);
    if (runtime.firstTokenTimer) clearTimeout(runtime.firstTokenTimer);
    this.recordTransportUsage(jobId, runtime, Date.now());
    const job = (await this.store.getJob(jobId));
    if (job) {
      if (this.activeSessions.get(job.sessionId) === jobId) {
        this.activeSessions.delete(job.sessionId);
      }
    }
    runtime.queue.close();
    this.runtimes.delete(jobId);
  }

  private captureRuntimeTransportSnapshot(): RuntimeTransportSnapshot[] {
    const snapshot = (
      this.hub as WorkerHub & {
        runtimeTransportSnapshot?: () => RuntimeTransportSnapshot[];
      }
    ).runtimeTransportSnapshot;
    if (typeof snapshot !== "function") return [];
    try {
      return snapshot.call(this.hub).map((item) => ({ ...item }));
    } catch {
      // Transport telemetry must never turn a valid inference into a failure.
      return [];
    }
  }

  private async buildCompletionNetworkTrace(
    jobId: string,
    runtime: RuntimeJob,
    observedUntil: number,
    endTransports: readonly RuntimeTransportSnapshot[],
    contendedBoundaryKeys: ReadonlySet<string>,
  ): Promise<NetworkExecutionTrace> {
    const shared = {
      jobId,
      attempt: runtime.attempt,
      route: runtime.route,
      routeDecision: runtime.routeDecision,
      observedFrom: runtime.attemptStartedAt,
      observedUntil,
    };
    try {
      return buildNetworkExecutionTrace({
        ...shared,
        workers: (await this.store.listWorkers()),
        startTransports: runtime.attemptTransportStart,
        endTransports,
        contendedBoundaryKeys,
      });
    } catch {
      // Preserve a strictly valid route-selection trace while refusing to
      // expose malformed stage or transport observations as measurements.
      return buildNetworkExecutionTrace({
        ...shared,
        workers: [],
        startTransports: [],
        endTransports: [],
      });
    }
  }

  private contendedBoundaryKeys(
    jobId: string,
    startedAt: number,
    endedAt: number,
    boundaryKeys: ReadonlySet<string>,
  ): Set<string> {
    const contended = new Set<string>();
    const consider = (
      otherJobId: string,
      otherStartedAt: number,
      otherEndedAt: number,
      otherBoundaryKeys: ReadonlySet<string>,
    ): void => {
      if (
        otherJobId === jobId
        || otherStartedAt > endedAt
        || otherEndedAt < startedAt
      ) return;
      for (const key of boundaryKeys) {
        if (otherBoundaryKeys.has(key)) contended.add(key);
      }
    };
    for (const [otherJobId, runtime] of this.runtimes) {
      consider(
        otherJobId,
        runtime.attemptStartedAt,
        Date.now(),
        runtime.attemptBoundaryKeys,
      );
    }
    for (const interval of this.recentTransportUsage) {
      consider(
        interval.jobId,
        interval.startedAt,
        interval.endedAt,
        interval.boundaryKeys,
      );
    }
    return contended;
  }

  private recordTransportUsage(
    jobId: string,
    runtime: RuntimeJob,
    endedAt: number,
  ): void {
    if (runtime.attemptBoundaryKeys.size === 0) return;
    this.recentTransportUsage.unshift({
      jobId,
      startedAt: runtime.attemptStartedAt,
      endedAt,
      boundaryKeys: new Set(runtime.attemptBoundaryKeys),
    });
    const cutoff = Date.now() - 60 * 60 * 1_000;
    while (
      this.recentTransportUsage.length > 0
      && (
        this.recentTransportUsage.length > 1_024
        || this.recentTransportUsage.at(-1)!.endedAt < cutoff
      )
    ) {
      this.recentTransportUsage.pop();
    }
  }

  private async validJobEnvelope(workerId: string, jobId: string, leaseId: string): Promise<StoredJob | null> {
    const job = (await this.store.getJob(jobId));
    if (!job || job.workerId !== workerId || job.leaseId !== leaseId) return null;
    if (["completed", "failed", "cancelled", "expired"].includes(job.status)) return null;
    return job;
  }

  private async firstTokenTimeoutFor(jobId: string, runtime: RuntimeJob): Promise<number> {
    if (this.options.firstTokenTimeoutMs !== undefined) {
      return Math.max(10, Math.round(this.options.firstTokenTimeoutMs));
    }
    const routeStage = runtime.route.stages[0];
    const routeWorker = routeStage ? (await this.store.getWorker(routeStage.workerId)) : null;
    const deployment = routeWorker?.capabilities.deployments.find(
      (candidate) => candidate.deploymentId === routeStage?.deploymentId,
    );
    const expectedTtftMs = deployment?.ttftMs ?? 2_500;
    const adaptiveTimeoutMs = Math.max(15_000, expectedTtftMs * 6 + 2_000);
    const job = (await this.store.getJob(jobId));
    const remainingMs = job ? Math.max(1_000, job.deadlineAt - Date.now() - 1_000) : 30_000;
    // An embedding is an atomic vector batch, not incremental text. Do not
    // apply the text decoder's 15-second first-token estimate to its full job.
    if (isDecisionDeployment(deployment)) return Math.max(1_000, Math.min(DECISION_DEADLINE_MS, remainingMs));
    if (isEmbeddingDeployment(deployment)) return Math.max(1_000, Math.min(300_000, remainingMs));
    if (this.options.modelRequestTimeoutsMs && Object.hasOwn(this.options.modelRequestTimeoutsMs, runtime.request.model)) {
      return Math.max(1_000, Math.min(120_000, remainingMs));
    }
    return Math.max(1_000, Math.min(30_000, adaptiveTimeoutMs, remainingMs));
  }

  private async validateCompletion(
    job: StoredJob,
    runtime: RuntimeJob,
    result: CompletionResult,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const worker = job.workerId ? (await this.store.getWorker(job.workerId)) : null;
    const deployment = worker?.capabilities.deployments.find(
      (candidate) => candidate.deploymentId === job.deploymentId,
    );
    if (!worker || !deployment) return { ok: false, reason: "Worker deployment disappeared" };
    if (deployment.modelDigest !== job.modelDigest) {
      return { ok: false, reason: "Model digest mismatch" };
    }
    const expectedInput = runtime.promptCheckpoint.inputTokens;
    const promptBytes = runtime.promptCheckpoint.request.messages.reduce(
      (sum, message) => sum + Buffer.byteLength(`${message.role}\n${message.content}`, "utf8"),
      0,
    );
    // The coordinator's characters/4 estimate is useful for scheduling, but
    // it is not an exact tokenizer. Real chat templates add control tokens and
    // byte-level tokenizers can legitimately diverge by far more than 10%.
    // Keep the trust boundary by bounding the worker report against both the
    // request bytes and the deployment's certified context window.
    const plausibleInputMaximum = Math.min(
      deployment.contextLimit,
      Math.max(
        64,
        expectedInput * 8,
        promptBytes * 2 + 256 + runtime.promptCheckpoint.request.messages.length * 64,
      ),
    );
    if (result.metrics.inputTokens < 1 || result.metrics.inputTokens > plausibleInputMaximum) {
      return { ok: false, reason: "Implausible input token count" };
    }
    if (isKokoroDeployment(deployment)) return validateSpeechCompletion(runtime.request, result, runtime.output);
    if (isDecisionDeployment(deployment)) {
      try {
        const envelope = verifiedDecisionEnvelope(runtime.output, parseDecisionRequest(runtime.request));
        if (result.text !== runtime.output || result.finishReason !== "stop" || result.metrics.outputTokens !== 0
          || result.metrics.inputTokens !== envelope.usage.prompt_tokens) throw new Error("decision_billing_mismatch");
        return { ok: true };
      } catch { return { ok: false, reason: "Decision integrity validation failed" }; }
    }
    if (isEmbeddingDeployment(deployment)) {
      try {
        const envelope = verifiedEmbeddingEnvelope(runtime.output, parseEmbeddingRequest(runtime.request));
        if (result.text !== runtime.output || result.finishReason !== "stop" || result.metrics.outputTokens !== 0 || result.metrics.inputTokens !== envelope.result.usage.prompt_tokens) throw new Error("embedding_billing_mismatch");
        return { ok: true };
      } catch { return { ok: false, reason: "Embedding integrity validation failed" }; }
    }
    const maximumOutputTokens = runtime.request.max_tokens ?? 256;
    const outputBytes = Buffer.byteLength(runtime.output, "utf8");
    // Output text length is not a tokenizer. Byte-level tokens, Unicode and
    // model-specific vocabularies can differ dramatically from characters/4,
    // especially for tiny/random validation models. Keep the trust boundary
    // against the caller's token ceiling and the actual emitted bytes instead.
    if (
      result.metrics.outputTokens < 0 ||
      result.metrics.outputTokens > maximumOutputTokens ||
      (runtime.output.length > 0 && result.metrics.outputTokens === 0) ||
      result.metrics.outputTokens > outputBytes + 16
    ) {
      return { ok: false, reason: "Implausible output token count" };
    }
    if (result.text !== runtime.output) return { ok: false, reason: "Completion body mismatch" };
    if (outputBytes > maximumOutputTokens * 32) {
      return { ok: false, reason: "Completion exceeds the configured expansion limit" };
    }
    return { ok: true };
  }

  private async recoverOrphanedJobs(): Promise<void> {
    for (const job of (await this.store.listNonterminalJobs())) {
      (await this.store.setJobStatus(job.id, "failed", "coordinator_restarted"));
    }
  }
}

function routeOptionsForRequest(request: ChatCompletionRequest, connectedWorkerIds: ReadonlySet<string>) {
  const pinned = request.privacy?.boundary === "pinned-edges"
    ? new Set(request.privacy.pinned_identity_ids ?? [])
    : undefined;
  return {
    connectedWorkerIds,
    routePolicy: {
      requireTrustedBoundaryIdentity: true,
      requireTrustedIdentity: request.privacy?.trust === "trusted-only",
      ...(pinned ? { pinnedBoundaryIdentityIds: pinned } : {}),
    },
  };
}

function privacyFailureFor(reasons: readonly string[]): { code: string; message: string } | null {
  if (reasons.includes("candidate_boundary_pin_rejected")) return {
    code: "boundary_pin_unavailable",
    message: "No route keeps every sensitive edge on an explicitly pinned trusted identity",
  };
  if (reasons.includes("candidate_trust_rejected")) return {
    code: "trusted_route_unavailable",
    message: "No route satisfies the request's trusted-only policy",
  };
  if (reasons.includes("candidate_boundary_trust_rejected")) return {
    code: "trusted_boundary_unavailable",
    message: "No route keeps the sensitive input and output boundaries on trusted identities",
  };
  return null;
}

function executionPrivacyTrace(request: ChatCompletionRequest) {
  return {
    trust: request.privacy?.trust ?? "default",
    boundary: request.privacy?.boundary ?? "trusted-edges",
    pinnedIdentityHashes: [...new Set(request.privacy?.pinned_identity_ids ?? [])]
      .map((id) => sha256CanonicalEvidence({ kind: "worker-identity", id }))
      .sort(),
  } as const;
}

export class MeshServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MeshServiceError";
  }
}

function selectFallbackDecision(
  decision: ExecutionRouteDecisionRecord,
  route: ScheduledRoute,
): void {
  const candidateId = route.stages
    .map((stage) => `${stage.workerId}:${stage.deploymentId}:${stage.modelDigest}:${stage.stageIndex}`)
    .join("|");
  const fallback = decision.fallbacks.find((candidate) => candidate.candidateId === candidateId);
  if (!fallback) return;
  decision.selected = { ...fallback, reason: "selected_fallback_after_failure" };
  decision.selectedKind = fallback.kind;
  decision.fallbacks = decision.fallbacks.filter(
    (candidate) => candidate.candidateId !== candidateId,
  );
  decision.reasons = ["selected_fallback_after_failure"];
}

function generationOnlyRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({ ...message })),
    ...(request.session_id === undefined ? {} : { session_id: request.session_id }),
    ...(request.max_tokens === undefined ? {} : { max_tokens: request.max_tokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.top_p === undefined ? {} : { top_p: request.top_p }),
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(request.language === undefined ? {} : { language: request.language }),
    ...(request.voice === undefined ? {} : { voice: request.voice }),
    ...(request.speed === undefined ? {} : { speed: request.speed }),
    ...(request.privacy === undefined ? {} : { privacy: {
      ...request.privacy,
      ...(request.privacy.pinned_identity_ids
        ? { pinned_identity_ids: [...request.privacy.pinned_identity_ids] }
        : {}),
    } }),
  };
}

function cloneRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  return {
    ...request,
    messages: request.messages.map((message) => ({ ...message })),
  };
}

function createPromptCheckpoint(request: ChatCompletionRequest): PromptCheckpoint {
  const checkpointRequest = generationOnlyRequest(request);
  return {
    request: checkpointRequest,
    requestHash: inputHashForRequest(checkpointRequest),
    inputTokens: estimateInputTokens(checkpointRequest),
  };
}
