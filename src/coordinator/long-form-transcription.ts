import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_TRANSCRIPTION_AUDIO_BYTES, TRANSCRIPTION_MODEL, transcriptionInputSchema,
  verifiedTranscriptionEnvelope, type TranscriptionInput } from "../contracts/transcription.js";

/**
 * Long-form transcription (specs/long-form-transcription, phase 1).
 *
 * A recording is cut at silences into pieces within the per-request limit and
 * every piece is sent as an ordinary `/v1/chat/completions` transcription
 * request under the caller's own credentials. Admission, credit holds,
 * receipts, settlement and dispersion therefore stay exactly those of a single
 * dictation request; this module adds no charge and never replays a piece that
 * may have reached a worker.
 */

export const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 320; // 20 ms
const MAX_PIECE_SAMPLES = (MAX_TRANSCRIPTION_AUDIO_BYTES - 44) / 2; // 30 s
const DEFAULT_TARGET_PIECE_SAMPLES = 29 * SAMPLE_RATE;
const CUT_SEARCH_SAMPLES = 8 * SAMPLE_RATE;
const SMOOTH_FRAMES = 15; // 300 ms of context when choosing the quietest cut
const PAD_SAMPLES = 0.2 * SAMPLE_RATE;
const MIN_SPEECH_SAMPLES = 0.3 * SAMPLE_RATE;
const MIN_SPEECH_RMS = 60; // about -55 dBFS: below this a frame is never speech
const FLAT_SPEECH_RMS = 300; // about -40 dBFS: a recording without pauses this loud is speech

export const DEFAULT_MAX_SECONDS = 30 * 60;
export const MAX_CONFIGURABLE_SECONDS = 3 * 60 * 60;
export const DEFAULT_PARALLEL = 2;
export const MAX_PARALLEL = 8;
const DEFAULT_JOB_DEADLINE_MS = 30 * 60_000;
const PIECE_DEADLINE_MS = 55_000;
const DEFAULT_CAPACITY_WAIT_MS = 60_000;
const MAX_CONCURRENT_UPLOADS = 4;

export class LongTranscriptionError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) { super(message); }
}

/** Validates a canonical mono 16 kHz PCM WAV of any length and returns its samples. */
export function canonicalWavSamples(audio: Buffer): Int16Array {
  if (audio.length < 46 || audio.length % 2
    || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 16) !== "WAVEfmt "
    || audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16
    || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
    || audio.readUInt32LE(24) !== SAMPLE_RATE || audio.readUInt32LE(28) !== SAMPLE_RATE * 2
    || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
    || audio.toString("ascii", 36, 40) !== "data" || audio.readUInt32LE(40) !== audio.length - 44) {
    throw new LongTranscriptionError("transcription_audio_invalid",
      "Send canonical mono 16 kHz 16-bit PCM WAV.", 400);
  }
  const samples = new Int16Array((audio.length - 44) / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = audio.readInt16LE(44 + index * 2);
  return samples;
}

export function wavFromSamples(samples: Int16Array): Buffer {
  const audio = Buffer.alloc(44 + samples.length * 2);
  audio.write("RIFF", 0, "ascii"); audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8, "ascii"); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(SAMPLE_RATE, 24); audio.writeUInt32LE(SAMPLE_RATE * 2, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36, "ascii"); audio.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) audio.writeInt16LE(samples[index]!, 44 + index * 2);
  return audio;
}

function frameRms(samples: Int16Array): Float64Array {
  const frames = new Float64Array(Math.ceil(samples.length / FRAME_SAMPLES));
  for (let frame = 0; frame < frames.length; frame += 1) {
    const start = frame * FRAME_SAMPLES, end = Math.min(samples.length, start + FRAME_SAMPLES);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index]! * samples[index]!;
    frames[frame] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return frames;
}

/** Speech threshold: well above the recording's own noise floor, never below an absolute minimum. */
function speechThreshold(rms: Float64Array): number {
  const sorted = Float64Array.from(rms).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  // A flat recording has no pauses to learn a floor from: decide by its level alone.
  if (peak < floor * 2) return floor >= FLAT_SPEECH_RMS ? 0 : Number.POSITIVE_INFINITY;
  return Math.max(MIN_SPEECH_RMS, Math.min(floor * 3.2, Math.sqrt(floor * peak)));
}

export interface PlannedPiece { readonly start: number; readonly end: number }

/**
 * Packs the recording into pieces of at most `targetSamples`, cutting at the
 * quietest smoothed point of the last seconds before each limit. Silent pieces
 * are dropped and each piece's silent edges are trimmed to a short pad, so the
 * network never transcribes (or bills) silence.
 */
export function planPieces(samples: Int16Array, targetSamples = DEFAULT_TARGET_PIECE_SAMPLES): PlannedPiece[] {
  if (!Number.isSafeInteger(targetSamples) || targetSamples < 2 * SAMPLE_RATE || targetSamples > MAX_PIECE_SAMPLES) {
    throw new Error("invalid_piece_target");
  }
  const rms = frameRms(samples);
  const threshold = speechThreshold(rms);
  const speech = rms.map(value => value >= threshold ? 1 : 0);
  const smooth = new Float64Array(rms.length);
  let window = 0;
  for (let frame = 0; frame < rms.length; frame += 1) {
    window += rms[frame]!;
    if (frame >= SMOOTH_FRAMES) window -= rms[frame - SMOOTH_FRAMES]!;
    smooth[frame] = window / Math.min(frame + 1, SMOOTH_FRAMES);
  }
  const cuts: number[] = [0];
  let cursor = 0;
  while (samples.length - cursor > targetSamples) {
    const limit = cursor + targetSamples;
    const firstFrame = Math.ceil(Math.max(cursor + SAMPLE_RATE, limit - CUT_SEARCH_SAMPLES) / FRAME_SAMPLES);
    const lastFrame = Math.floor(limit / FRAME_SAMPLES);
    let best = lastFrame, bestValue = Number.POSITIVE_INFINITY;
    for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
      // The smoothed value at frame f covers the window ending at f; centre the cut in it.
      const value = smooth[Math.min(rms.length - 1, frame + (SMOOTH_FRAMES >> 1))]!;
      if (value < bestValue) { bestValue = value; best = frame; }
    }
    cursor = Math.min(limit, best * FRAME_SAMPLES);
    cuts.push(cursor);
  }
  cuts.push(samples.length);
  const pieces: PlannedPiece[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const from = cuts[index]!, to = cuts[index + 1]!;
    let first = -1, last = -1, voiced = 0;
    for (let frame = Math.floor(from / FRAME_SAMPLES); frame * FRAME_SAMPLES < to; frame += 1) {
      if (!speech[frame]) continue;
      voiced += FRAME_SAMPLES;
      if (first < 0) first = frame;
      last = frame;
    }
    if (first < 0 || voiced < MIN_SPEECH_SAMPLES) continue;
    pieces.push({
      start: Math.max(from, first * FRAME_SAMPLES - PAD_SAMPLES),
      end: Math.min(to, (last + 1) * FRAME_SAMPLES + PAD_SAMPLES),
    });
  }
  return pieces;
}

export interface PieceTranscript {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly language: "es" | "en";
  readonly inputTokens: number;
  readonly requestId: string | null;
}

export interface LongTranscriptResult {
  readonly object: "transcription.long";
  readonly model: string;
  readonly requested_language: TranscriptionInput["language"];
  readonly duration: number;
  readonly text: string;
  readonly segments: ReadonlyArray<{ index: number; start: number; end: number; text: string; language: "es" | "en" }>;
  readonly usage: { input_tokens: number; output_tokens: 0; tokenizer: "cl100k_base"; pieces: number };
}

const seconds = (samples: number) => Math.round((samples / SAMPLE_RATE) * 1000) / 1000;

export function mergeTranscripts(pieces: readonly PieceTranscript[], totalSamples: number,
  language: TranscriptionInput["language"]): LongTranscriptResult {
  const ordered = [...pieces].sort((left, right) => left.index - right.index);
  return {
    object: "transcription.long",
    model: TRANSCRIPTION_MODEL,
    requested_language: language,
    duration: seconds(totalSamples),
    text: ordered.map(piece => piece.text.trim()).filter(Boolean).join(" "),
    segments: ordered.map(piece => ({ index: piece.index, start: seconds(piece.start), end: seconds(piece.end),
      text: piece.text.trim(), language: piece.language })),
    usage: { input_tokens: ordered.reduce((sum, piece) => sum + piece.inputTokens, 0), output_tokens: 0,
      tokenizer: "cl100k_base", pieces: ordered.length },
  };
}

function timestamp(value: number, separator: "," | "."): string {
  const millis = Math.round(value * 1000);
  const pad = (number: number, width = 2) => String(number).padStart(width, "0");
  return `${pad(Math.floor(millis / 3_600_000))}:${pad(Math.floor(millis / 60_000) % 60)}:`
    + `${pad(Math.floor(millis / 1000) % 60)}${separator}${pad(millis % 1000, 3)}`;
}

export function toSrt(result: LongTranscriptResult): string {
  return result.segments.map((segment, position) =>
    `${position + 1}\n${timestamp(segment.start, ",")} --> ${timestamp(segment.end, ",")}\n${segment.text}\n`).join("\n");
}

export function toVtt(result: LongTranscriptResult): string {
  return `WEBVTT\n\n${result.segments.map(segment =>
    `${timestamp(segment.start, ".")} --> ${timestamp(segment.end, ".")}\n${segment.text}\n`).join("\n")}`;
}

/** What a piece submission returned: an HTTP status and the parsed JSON body. */
export interface PieceResponse { readonly status: number; readonly body: unknown; readonly retryAfterSeconds?: number | undefined; readonly requestId?: string | null }
export type SubmitPiece = (body: Record<string, unknown>) => Promise<PieceResponse>;

function errorCode(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Refusals that the coordinator issues before any worker receives the piece.
 * Anything else may have executed (and been billed) and is never replayed.
 */
export function isPreDispatchRefusal(response: PieceResponse): boolean {
  const code = errorCode(response.body);
  return (response.status === 429 && (code === "concurrency_limit_exceeded" || code === "rate_limit_exceeded"))
    || (response.status === 503 && code === "no_capacity");
}

export interface RunOptions {
  readonly samples: Int16Array;
  readonly pieces: readonly PlannedPiece[];
  readonly language: TranscriptionInput["language"];
  readonly parallel: number;
  readonly dispersionGroup: string | null;
  readonly deadlineMs: number;
  /** Longest wait per piece while no replica has capacity (concurrency refusals use the job deadline). */
  readonly capacityWaitMs?: number;
  readonly submit: SubmitPiece;
  readonly signal?: AbortSignal;
  readonly onPiece?: ((piece: PieceTranscript, completed: number) => void) | undefined;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

export class LongTranscriptionPieceError extends LongTranscriptionError {
  constructor(code: string, message: string, statusCode: number, readonly completed: readonly PieceTranscript[]) {
    super(code, message, statusCode);
  }
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

function pieceEnvelope(samples: Int16Array, piece: PlannedPiece, language: TranscriptionInput["language"]): TranscriptionInput {
  const audio = wavFromSamples(samples.subarray(piece.start, piece.end));
  return transcriptionInputSchema.parse({ schema: "mycellios-transcription-input/1",
    audio: { format: "wav", sha256: createHash("sha256").update(audio).digest("hex"), data: audio.toString("base64") },
    language });
}

/** Transcribes every piece with bounded parallelism; stops dispatching after the first definitive failure. */
export async function runLongTranscription(options: RunOptions): Promise<PieceTranscript[]> {
  const sleep = options.sleep ?? defaultSleep, now = options.now ?? Date.now;
  const deadline = now() + options.deadlineMs;
  const completed: PieceTranscript[] = [];
  // A holder, not a bare variable: lanes assign it inside closures TypeScript cannot follow.
  const state: { failure: LongTranscriptionError | null } = { failure: null };
  let next = 0;
  const transcribe = async (index: number) => {
    const piece = options.pieces[index]!;
    const envelope = pieceEnvelope(options.samples, piece, options.language);
    const body: Record<string, unknown> = { model: TRANSCRIPTION_MODEL, max_tokens: 1, deadline_ms: PIECE_DEADLINE_MS,
      stream: false, messages: [{ role: "user", content: JSON.stringify(envelope) }] };
    if (options.dispersionGroup) body.dispersion = { group: options.dispersionGroup };
    const capacityDeadline = now() + (options.capacityWaitMs ?? DEFAULT_CAPACITY_WAIT_MS);
    for (let attempt = 0; ; attempt += 1) {
      if (state.failure || options.signal?.aborted) return;
      const response = await options.submit(body);
      if (response.status === 200) {
        const content = (response.body as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> })
          ?.choices?.[0];
        let result;
        try {
          if (content?.finish_reason !== "stop" || typeof content.message?.content !== "string") throw new Error("incomplete");
          result = verifiedTranscriptionEnvelope(content.message.content, envelope);
        } catch {
          throw new LongTranscriptionError("transcription_piece_invalid", `Piece ${index + 1} returned an invalid transcript.`, 502);
        }
        const transcript: PieceTranscript = { index, start: piece.start, end: piece.end, text: result.text,
          language: result.language, inputTokens: result.usage.input_tokens, requestId: response.requestId ?? null };
        completed.push(transcript);
        options.onPiece?.(transcript, completed.length);
        return;
      }
      const delay = Math.min(15_000, Math.max((response.retryAfterSeconds ?? 0) * 1000, 1000 * 2 ** Math.min(attempt, 4)))
        + Math.floor(Math.random() * 250);
      const waitLimit = response.status === 503 ? Math.min(deadline, capacityDeadline) : deadline;
      if (!isPreDispatchRefusal(response) || now() + delay > waitLimit) {
        const code = errorCode(response.body) ?? "transcription_piece_failed";
        const message = (response.body as { error?: { message?: unknown } } | null)?.error?.message;
        throw new LongTranscriptionError(code, typeof message === "string" ? message
          : `Piece ${index + 1} failed.`, response.status >= 400 ? response.status : 502);
      }
      await sleep(delay, options.signal);
    }
  };
  const lane = async () => {
    while (!state.failure && !options.signal?.aborted && next < options.pieces.length) {
      const index = next++;
      try { await transcribe(index); }
      catch (error) {
        state.failure ??= error instanceof LongTranscriptionError ? error
          : new LongTranscriptionError("transcription_piece_failed", `Piece ${index + 1} failed.`, 502);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.parallel, options.pieces.length) }, lane));
  const done = [...completed].sort((left, right) => left.index - right.index);
  const failure = state.failure;
  if (failure) throw new LongTranscriptionPieceError(failure.code, failure.message, failure.statusCode, done);
  if (options.signal?.aborted) throw new LongTranscriptionPieceError("client_closed", "The caller disconnected.", 499, done);
  return done;
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("invalid_long_transcription_config");
  return value;
}

export interface LongTranscriptionRouteOptions {
  /** Longest accepted recording; MYCELLIOS_LONG_TRANSCRIPTION_MAX_SECONDS by default. */
  readonly maxSeconds?: number;
  readonly jobDeadlineMs?: number;
  /** MYCELLIOS_LONG_TRANSCRIPTION_CAPACITY_WAIT_SECONDS by default. */
  readonly capacityWaitMs?: number;
  /** False only when the coordinator runs without API access (local development). */
  readonly requireCredential?: boolean;
}

const querySchema = z.object({
  language: z.enum(["es", "en", "auto"]).default("auto"),
  format: z.enum(["json", "text", "srt", "vtt"]).default("json"),
  stream: z.enum(["true", "false"]).default("false"),
  parallel: z.coerce.number().int().min(1).max(MAX_PARALLEL).default(DEFAULT_PARALLEL),
  dispersion: z.enum(["true", "false"]).default("false"),
}).strict();

const FORWARDED_HEADERS = ["authorization", "user-agent", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-proto", "x-real-ip", "forwarded"] as const;

/**
 * Each piece is injected under the caller's own headers and address, so its
 * authentication, trust and rate limits are exactly those of the caller
 * sending that piece directly.
 */
function injectSubmitter(app: FastifyInstance, request: FastifyRequest): SubmitPiece {
  const headers: Record<string, string> = { "content-type": "application/json", "x-mycellios-funding": "contribution-credits" };
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return async (body) => {
    const response = await app.inject({ method: "POST", url: "/v1/chat/completions", remoteAddress: request.ip,
      headers, payload: JSON.stringify(body) });
    let parsed: unknown = null;
    try { parsed = response.json(); } catch { parsed = null; }
    const retryAfter = Number(response.headers["retry-after"]);
    const requestId = response.headers["x-network-request-id"];
    return { status: response.statusCode, body: parsed, retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      requestId: typeof requestId === "string" ? requestId : null };
  };
}

export function registerLongFormTranscriptionRoutes(app: FastifyInstance, options: LongTranscriptionRouteOptions = {}): void {
  const maxSeconds = options.maxSeconds
    ?? boundedInteger(process.env.MYCELLIOS_LONG_TRANSCRIPTION_MAX_SECONDS, DEFAULT_MAX_SECONDS, 30, MAX_CONFIGURABLE_SECONDS);
  const jobDeadlineMs = options.jobDeadlineMs ?? DEFAULT_JOB_DEADLINE_MS;
  const capacityWaitMs = options.capacityWaitMs ?? 1000 * boundedInteger(
    process.env.MYCELLIOS_LONG_TRANSCRIPTION_CAPACITY_WAIT_SECONDS, DEFAULT_CAPACITY_WAIT_MS / 1000, 0, 600);
  const bodyLimit = 44 + maxSeconds * SAMPLE_RATE * 2;
  let uploads = 0;
  void app.register(async (scope) => {
    scope.addContentTypeParser(["audio/wav", "audio/x-wav", "audio/wave"], { parseAs: "buffer", bodyLimit },
      (_request, body, done) => done(null, body));
    scope.post("/v1/audio/transcriptions/long", {
      bodyLimit,
      // Large bodies are buffered before authentication runs, so bound how many
      // can be in flight and refuse requests that carry no credential at all.
      onRequest: async (request, reply) => {
        if (options.requireCredential !== false && !request.headers.authorization) return reply.code(401).send({ error: { code: "authentication_required",
          message: "Sign in or provide a Mycellios API key." } });
        if (uploads >= MAX_CONCURRENT_UPLOADS) return reply.code(429).header("retry-after", "5").send({
          error: { code: "long_transcription_busy", message: "Too many long recordings are being transcribed. Retry shortly." } });
        uploads += 1;
        let released = false;
        const release = () => { if (!released) { released = true; uploads -= 1; } };
        reply.raw.once("close", release);
        reply.raw.once("finish", release);
      },
    }, async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: { code: "invalid_long_transcription_request",
        message: "Use language es|en|auto, format json|text|srt|vtt, stream, parallel 1-8 and dispersion." } });
      if (request.headers["x-mycellios-funding"] !== "contribution-credits") {
        return reply.code(400).send({ error: { code: "transcription_funding_required",
          message: "Network transcription requires explicit contribution-credit funding." } });
      }
      if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: { code: "transcription_audio_invalid",
        message: "Send the recording as audio/wav." } });
      const samples = canonicalWavSamples(request.body);
      const pieces = planPieces(samples);
      if (pieces.length === 0) return reply.code(422).send({ error: { code: "transcription_no_speech",
        message: "The recording contains no detectable speech." } });
      const { language, format, parallel } = query.data;
      const abort = new AbortController();
      reply.raw.once("close", () => { if (!reply.raw.writableFinished) abort.abort(); });
      const run = (onPiece?: RunOptions["onPiece"]) => runLongTranscription({ samples, pieces, language, parallel,
        dispersionGroup: query.data.dispersion === "true" ? `lf${randomBytes(15).toString("hex")}` : null,
        deadlineMs: jobDeadlineMs, capacityWaitMs, submit: injectSubmitter(app, request), signal: abort.signal, onPiece });
      const failureBody = (error: LongTranscriptionPieceError) => ({
        error: { code: error.code, message: error.message },
        completed: mergeTranscripts(error.completed, samples.length, language),
        total_pieces: pieces.length,
      });

      if (query.data.stream === "true") {
        reply.hijack();
        reply.raw.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
        const write = (event: unknown) => { if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`); };
        write({ type: "accepted", total_pieces: pieces.length, duration: seconds(samples.length) });
        const heartbeat = setInterval(() => write({ type: "heartbeat" }), 10_000);
        heartbeat.unref();
        try {
          const done = await run((piece, completed) => write({ type: "segment", completed, total_pieces: pieces.length,
            segment: { index: piece.index, start: seconds(piece.start), end: seconds(piece.end), text: piece.text.trim(),
              language: piece.language } }));
          write({ type: "done", result: mergeTranscripts(done, samples.length, language) });
        } catch (error) {
          if (error instanceof LongTranscriptionPieceError) write({ type: "error", status: error.statusCode, ...failureBody(error) });
          else write({ type: "error", status: 500, error: { code: "long_transcription_failed", message: "The transcription failed." } });
        } finally {
          clearInterval(heartbeat);
          reply.raw.end();
        }
        return reply;
      }

      try {
        const result = mergeTranscripts(await run(), samples.length, language);
        if (format === "text") return reply.type("text/plain; charset=utf-8").send(result.text);
        if (format === "srt") return reply.type("application/x-subrip; charset=utf-8").send(toSrt(result));
        if (format === "vtt") return reply.type("text/vtt; charset=utf-8").send(toVtt(result));
        return result;
      } catch (error) {
        if (!(error instanceof LongTranscriptionPieceError)) throw error;
        return reply.code(error.statusCode === 499 ? 400 : error.statusCode).send(failureBody(error));
      }
    });
    scope.setErrorHandler((error, _request, reply) => {
      if (error instanceof LongTranscriptionError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    });
  });
}
