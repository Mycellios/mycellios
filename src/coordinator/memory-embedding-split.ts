import {
  MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_PIECE_OVERHEAD_MS, MEMORY_EMBEDDING_REVISION, MEMORY_EMBEDDING_SCHEMA,
  estimatedMemoryEmbeddingTokens, parseMemoryEmbeddingRequest, verifiedMemoryEmbeddingEnvelope,
  type MemoryEmbeddingEnvelope, type MemoryEmbeddingInput,
} from "../contracts/memory-embedding.js";
import type { ChatCompletionRequest, CompletionMetrics, CompletionResult, ScheduledRoute } from "../contracts/types.js";

/**
 * Coordinator-side splitting of one memory embedding request
 * (specs/memory-embedding-qwen06/spec.md, "Splitting across replicas").
 *
 * The inputs are divided into pieces sized from each idle qualified replica's
 * speed, so a fast GPU gets most of the texts and a slow CPU only what it can
 * finish at about the same time. Each piece is an ordinary job pinned to one
 * worker, so it keeps the per-piece validation (count, order, 1024 dimensions,
 * unit length, revision, usage). The vectors are reassembled in the original
 * order and the usage is the exact sum of the pieces.
 *
 * A piece that fails or runs out of its own time budget runs once more on a
 * different replica. Embeddings are deterministic and read-only, and a failed
 * attempt is never billed: usage and settlement come only from validated
 * pieces. Contribution-funded requests are never split, so the no-replay rule
 * for uncertain paid work is unchanged.
 */

export interface SplitReplica {
  route: ScheduledRoute;
  workerId: string;
  deploymentId: string;
  /** Measured input tokens per second, or the execution's prior before any measurement. */
  tokensPerSecond: number;
}

export interface PlannedPiece {
  /** Index into the replica list given to the planner. */
  replica: number;
  /** Positions of the texts in the original request, ascending. */
  indices: number[];
  tokens: number;
  predictedMs: number;
}

/**
 * Earliest-finish assignment: texts go largest first to the replica that
 * would finish them soonest, counting one fixed overhead per replica used.
 * A slow replica only receives a text when it still finishes no later than a
 * faster one would, so it never lengthens the request.
 */
export function planMemoryEmbeddingPieces(tokens: readonly number[], tokensPerSecond: readonly number[], overheadMs = MEMORY_EMBEDDING_PIECE_OVERHEAD_MS): PlannedPiece[] {
  if (tokensPerSecond.some((rate) => !(rate > 0))) throw new RangeError("replica rates must be positive");
  const load = tokensPerSecond.map(() => 0);
  const assigned: number[][] = tokensPerSecond.map(() => []);
  const order = tokens.map((_, index) => index).sort((left, right) => tokens[right]! - tokens[left]! || left - right);
  const finish = (replica: number, extra: number) => overheadMs + ((load[replica]! + extra) / tokensPerSecond[replica]!) * 1_000;
  for (const index of order) {
    let best = -1;
    for (let replica = 0; replica < tokensPerSecond.length; replica++) {
      if (best < 0) { best = replica; continue; }
      const candidate = finish(replica, tokens[index]!), current = finish(best, tokens[index]!);
      if (candidate < current || (candidate === current && tokensPerSecond[replica]! > tokensPerSecond[best]!)) best = replica;
    }
    if (best < 0) return [];
    load[best]! += tokens[index]!;
    assigned[best]!.push(index);
  }
  return assigned.flatMap((indices, replica) => indices.length === 0 ? [] : [{
    replica, indices: indices.sort((left, right) => left - right), tokens: load[replica]!, predictedMs: finish(replica, 0),
  }]);
}

const MIN_PIECE_DEADLINE_MS = 15_000;
/** Time left for a re-dispatch: a piece may use three times its prediction plus a margin. */
export function pieceDeadlineMs(predictedMs: number, remainingMs: number): number | null {
  const budget = Math.floor(Math.min(remainingMs - 250, Math.max(MIN_PIECE_DEADLINE_MS, predictedMs * 3 + 10_000)));
  return budget >= 1_000 ? budget : null;
}

export function predictedPieceMs(tokens: number, tokensPerSecond: number): number {
  return MEMORY_EMBEDDING_PIECE_OVERHEAD_MS + (tokens / tokensPerSecond) * 1_000;
}

export type SplitStreamEvent =
  | { type: "accepted"; jobId: string; sessionId: string; route: ScheduledRoute }
  | { type: "completed"; result: CompletionResult; pieces: CompletionResult[] }
  | { type: "failed"; code: string; message: string };

interface PieceEvent { type: string; result?: CompletionResult; code?: string; message?: string }

export interface MemoryEmbeddingSplitHost {
  /** Idle, freshly qualified replicas for this request, excluding the given workers. */
  idleReplicas(request: ChatCompletionRequest, excludeWorkerIds: ReadonlySet<string>): Promise<SplitReplica[]>;
  /** Starts a piece on exactly this worker; throws before any dispatch when it cannot. */
  submitPiece(request: ChatCompletionRequest, workerId: string): Promise<{ jobId: string; events: AsyncIterable<PieceEvent> }>;
  cancel(jobId: string): Promise<unknown>;
  completeParent(jobId: string, metrics: CompletionMetrics): Promise<void>;
  failParent(jobId: string, status: "failed" | "expired" | "cancelled", code: string): Promise<void>;
  /** Releases the parent session after its final event. */
  finished(jobId: string, sessionId: string): void;
}

interface Piece {
  indices: number[];
  texts: string[];
  tokens: number;
  /** Attempts that reached a replica; a second failure ends the request. */
  attempts: number;
  excluded: Set<string>;
  status: "pending" | "running" | "done";
  jobId: string | null;
  workerId: string | null;
  result: CompletionResult | null;
}

export class MemoryEmbeddingSplitRun {
  private readonly pieces: Piece[];
  private readonly startedAt = Date.now();
  private done = false;
  private scheduling = false;
  private scheduleAgain = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly deadlineTimer: NodeJS.Timeout;

  private constructor(
    private readonly host: MemoryEmbeddingSplitHost,
    private readonly parent: { jobId: string; sessionId: string; request: ChatCompletionRequest; input: MemoryEmbeddingInput; deadlineAt: number },
    private readonly emit: (event: SplitStreamEvent) => void,
    pieces: PlannedPiece[],
  ) {
    this.pieces = pieces.map((piece) => ({ indices: piece.indices, texts: piece.indices.map((index) => parent.input.input[index]!),
      tokens: piece.tokens, attempts: 0, excluded: new Set(), status: "pending", jobId: null, workerId: null, result: null }));
    this.deadlineTimer = setTimeout(() => { void this.fail("deadline_exceeded", "The split embedding request timed out", "expired"); },
      Math.max(0, parent.deadlineAt - Date.now()));
  }

  /**
   * Starts a split run when at least two idle qualified replicas would share
   * the work. Returns null to keep the ordinary single-replica path.
   */
  static async start(host: MemoryEmbeddingSplitHost, parent: { jobId: string; sessionId: string; request: ChatCompletionRequest; deadlineAt: number },
    emit: (event: SplitStreamEvent) => void, register: (run: MemoryEmbeddingSplitRun) => Promise<void>): Promise<MemoryEmbeddingSplitRun | null> {
    let input: MemoryEmbeddingInput;
    try { input = parseMemoryEmbeddingRequest(parent.request); } catch { return null; }
    if (input.input.length < 2) return null;
    const replicas = await host.idleReplicas(parent.request, new Set());
    if (replicas.length < 2) return null;
    const plan = planMemoryEmbeddingPieces(input.input.map(estimatedMemoryEmbeddingTokens), replicas.map((replica) => replica.tokensPerSecond));
    if (plan.length < 2) return null;
    const run = new MemoryEmbeddingSplitRun(host, { ...parent, input }, emit, plan);
    await register(run);
    emit({ type: "accepted", jobId: parent.jobId, sessionId: parent.sessionId, route: replicas[plan[0]!.replica]!.route });
    for (const [index, planned] of plan.entries()) await run.launch(run.pieces[index]!, replicas[planned.replica]!);
    void run.schedule();
    return run;
  }

  async cancel(): Promise<void> {
    await this.fail("cancelled", "Request cancelled", "cancelled", "cancelled_by_client");
  }

  private remainingMs(): number { return this.parent.deadlineAt - Date.now(); }

  private async launch(piece: Piece, replica: SplitReplica): Promise<void> {
    const deadline = pieceDeadlineMs(predictedPieceMs(piece.tokens, replica.tokensPerSecond), this.remainingMs());
    if (this.done || deadline === null) return;
    piece.status = "running";
    piece.workerId = replica.workerId;
    const request: ChatCompletionRequest = {
      model: MEMORY_EMBEDDING_MODEL, max_tokens: 1, stream: false, deadline_ms: deadline,
      messages: [{ role: "user", content: JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, input: piece.texts, input_type: this.parent.input.input_type }) }],
      ...(this.parent.request.workload_class ? { workload_class: this.parent.request.workload_class } : {}),
    };
    let handle: Awaited<ReturnType<MemoryEmbeddingSplitHost["submitPiece"]>>;
    try {
      handle = await this.host.submitPiece(request, replica.workerId);
    } catch {
      // Nothing ran: the replica was taken meanwhile. Try another one.
      piece.status = "pending";
      piece.workerId = null;
      piece.excluded.add(replica.workerId);
      return;
    }
    piece.attempts += 1;
    piece.jobId = handle.jobId;
    if (this.done) { await this.host.cancel(handle.jobId); return; }
    void this.consume(piece, handle, replica.workerId);
  }

  private async consume(piece: Piece, handle: { jobId: string; events: AsyncIterable<PieceEvent> }, workerId: string): Promise<void> {
    let completed: CompletionResult | null = null;
    let failure: PieceEvent | null = null;
    try {
      for await (const event of handle.events) {
        if (event.type === "completed" && event.result) completed = event.result;
        if (event.type === "failed") failure = event;
      }
    } catch (error) {
      failure = { type: "failed", code: "piece_stream_failed", message: error instanceof Error ? error.message : String(error) };
    }
    if (this.done || piece.jobId !== handle.jobId) return;
    piece.jobId = null;
    if (completed) {
      piece.status = "done";
      piece.result = completed;
      if (this.pieces.every((candidate) => candidate.status === "done")) await this.complete();
      else void this.schedule();
      return;
    }
    piece.excluded.add(workerId);
    piece.workerId = null;
    if (piece.attempts >= 2) {
      await this.fail(failure?.code ?? "piece_failed", `A piece failed on two replicas: ${failure?.message ?? "no result"}`);
      return;
    }
    piece.status = "pending";
    void this.schedule();
  }

  /** Places pending pieces on idle replicas that can finish them in the remaining time. */
  private async schedule(): Promise<void> {
    if (this.done) return;
    if (this.scheduling) { this.scheduleAgain = true; return; }
    this.scheduling = true;
    try {
      do {
        this.scheduleAgain = false;
        const pending = this.pieces.filter((piece) => piece.status === "pending").sort((left, right) => right.tokens - left.tokens);
        if (pending.length === 0) break;
        const busy = new Set(this.pieces.flatMap((piece) => piece.status === "running" && piece.workerId ? [piece.workerId] : []));
        const idle = (await this.host.idleReplicas(this.parent.request, busy)).sort((left, right) => right.tokensPerSecond - left.tokensPerSecond);
        for (const piece of pending) {
          if (this.done) return;
          const index = idle.findIndex((replica) => {
            const predicted = predictedPieceMs(piece.tokens, replica.tokensPerSecond);
            return !piece.excluded.has(replica.workerId) && predicted <= this.remainingMs() - 250
              && pieceDeadlineMs(predicted, this.remainingMs()) !== null;
          });
          if (index < 0) continue;
          const [replica] = idle.splice(index, 1);
          await this.launch(piece, replica!);
          // A replica taken meanwhile is excluded for this piece; look again at once.
          if (piece.status === "pending" && piece.excluded.has(replica!.workerId)) this.scheduleAgain = true;
        }
      } while (this.scheduleAgain && !this.done);
    } finally {
      this.scheduling = false;
    }
    if (!this.done && this.pieces.some((piece) => piece.status === "pending") && !this.pollTimer) {
      // Wait for another piece to free its replica, or for the deadline.
      this.pollTimer = setTimeout(() => { this.pollTimer = null; void this.schedule(); }, 500);
    }
  }

  private async complete(): Promise<void> {
    if (this.done) return;
    const data: MemoryEmbeddingEnvelope["result"]["data"] = new Array(this.parent.input.input.length);
    let tokens = 0;
    const results: CompletionResult[] = [];
    try {
      for (const piece of this.pieces) {
        // Each piece was already validated against its own texts by the mesh service.
        const envelope = verifiedMemoryEmbeddingEnvelope(piece.result!.text, { ...this.parent.input, input: piece.texts });
        for (const [offset, row] of envelope.result.data.entries()) {
          const index = piece.indices[offset]!;
          data[index] = { object: "embedding", index, embedding: row.embedding };
        }
        tokens += envelope.result.usage.prompt_tokens;
        results.push(piece.result!);
      }
      const text = JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, result: { object: "list", model: MEMORY_EMBEDDING_MODEL,
        revision: MEMORY_EMBEDDING_REVISION, data, usage: { prompt_tokens: tokens, total_tokens: tokens } } });
      verifiedMemoryEmbeddingEnvelope(text, this.parent.input);
      const elapsed = Date.now() - this.startedAt;
      const metrics: CompletionMetrics = { inputTokens: tokens, outputTokens: 0, ttftMs: elapsed, activeMs: elapsed };
      this.done = true;
      this.clearTimers();
      await this.host.completeParent(this.parent.jobId, metrics);
      this.emit({ type: "completed", pieces: results, result: { jobId: this.parent.jobId, leaseId: "", text, finishReason: "stop", metrics,
        ...(results[0]?.privacy ? { privacy: results[0].privacy } : {}) } });
    } catch {
      this.done = false;
      await this.fail("invalid_completion", "The reassembled embedding batch failed validation");
      return;
    }
    this.host.finished(this.parent.jobId, this.parent.sessionId);
  }

  private async fail(code: string, message: string, status: "failed" | "expired" | "cancelled" = "failed", storedCode = code): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.clearTimers();
    if (code === "deadline_exceeded") status = "expired";
    const running = this.pieces.flatMap((piece) => piece.jobId ? [piece.jobId] : []);
    await Promise.all(running.map(async (jobId) => { try { await this.host.cancel(jobId); } catch { /* already finished */ } }));
    await this.host.failParent(this.parent.jobId, status, storedCode);
    this.emit({ type: "failed", code, message });
    this.host.finished(this.parent.jobId, this.parent.sessionId);
  }

  private clearTimers(): void {
    clearTimeout(this.deadlineTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
