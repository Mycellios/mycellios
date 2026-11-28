import { resolve } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { TRANSCRIPTION_MODEL, transcriptionInputSchema } from "../src/contracts/transcription.js";
import { createCoordinator } from "../src/coordinator/server.js";
import {
  SAMPLE_RATE, canonicalWavSamples, isPreDispatchRefusal, mergeTranscripts, planPieces,
  registerLongFormTranscriptionRoutes, runLongTranscription, toSrt, toVtt, wavFromSamples,
  LongTranscriptionPieceError, type PieceResponse, type SubmitPiece,
} from "../src/coordinator/long-form-transcription.js";

/** Builds a recording from [seconds, speech?] spans: speech is a 220 Hz tone, silence is low noise. */
function recording(spans: ReadonlyArray<readonly [number, boolean]>): Int16Array {
  const total = spans.reduce((sum, [length]) => sum + Math.round(length * SAMPLE_RATE), 0);
  const samples = new Int16Array(total);
  let offset = 0, seed = 7;
  for (const [length, speech] of spans) {
    const count = Math.round(length * SAMPLE_RATE);
    for (let index = 0; index < count; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((seed % 21) - 10);
      samples[offset + index] = speech ? Math.round(8000 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE)) + noise : noise;
    }
    offset += count;
  }
  return samples;
}

function transcriptReply(body: Record<string, unknown>, text: string): PieceResponse {
  const content = String((body.messages as Array<{ content: string }>)[0]!.content);
  const input = transcriptionInputSchema.parse(JSON.parse(content));
  return { status: 200, requestId: "job", body: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    schema: "mycellios-transcription/1", model: TRANSCRIPTION_MODEL, audio_sha256: input.audio.sha256,
    language: "es", requested_language: input.language, text,
    usage: { input_tokens: 3, output_tokens: 0, tokenizer: "cl100k_base" } }) } }] } };
}

const noSleep = async () => undefined;

describe("long-form transcription segmentation", () => {
  it("round-trips canonical WAV and rejects other formats", () => {
    const samples = recording([[1, true]]);
    expect(Array.from(canonicalWavSamples(wavFromSamples(samples)))).toEqual(Array.from(samples));
    const stereo = wavFromSamples(samples);
    stereo.writeUInt16LE(2, 22);
    expect(() => canonicalWavSamples(stereo)).toThrow("canonical mono");
  });

  it("drops silence-only recordings and trims silent edges", () => {
    expect(planPieces(recording([[40, false]]))).toEqual([]);
    const [piece] = planPieces(recording([[3, false], [4, true], [3, false]]));
    expect(piece!.start / SAMPLE_RATE).toBeCloseTo(2.8, 1);
    expect(piece!.end / SAMPLE_RATE).toBeCloseTo(7.2, 1);
  });

  it("keeps every piece within the request limit and cuts inside pauses", () => {
    // 10 s speech blocks separated by 1 s pauses: cuts must fall in a pause.
    const spans: Array<readonly [number, boolean]> = [];
    for (let block = 0; block < 12; block += 1) spans.push([10, true], [1, false]);
    const samples = recording(spans);
    const pieces = planPieces(samples);
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    for (const piece of pieces) {
      expect(piece.end - piece.start).toBeLessThanOrEqual(30 * SAMPLE_RATE);
      expect(piece.end).toBeGreaterThan(piece.start);
    }
    for (let index = 0; index + 1 < pieces.length; index += 1) {
      const gap = (pieces[index]!.end / SAMPLE_RATE) % 11;
      // Each boundary lands in (or within the pad of) a pause at 10..11 s of its 11 s block.
      expect(gap).toBeGreaterThan(9.9);
    }
  });

  it("still cuts continuous speech at the limit", () => {
    const pieces = planPieces(recording([[75, true]]));
    expect(pieces.length).toBe(3);
    expect(pieces.every(piece => piece.end - piece.start <= 30 * SAMPLE_RATE)).toBe(true);
  });
});

describe("long-form transcription results", () => {
  const pieces = [
    { index: 1, start: 32_000, end: 64_000, text: " segunda ", language: "es" as const, inputTokens: 2, requestId: null },
    { index: 0, start: 0, end: 16_000, text: "primera", language: "es" as const, inputTokens: 1, requestId: null },
  ];

  it("merges in order with recording timestamps and summed usage", () => {
    const result = mergeTranscripts(pieces, 3_600 * SAMPLE_RATE + 8, "auto");
    expect(result.text).toBe("primera segunda");
    expect(result.segments.map(segment => [segment.start, segment.end])).toEqual([[0, 1], [2, 4]]);
    expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 0, tokenizer: "cl100k_base", pieces: 2 });
    expect(result.duration).toBe(3600.001);
  });

  it("renders SRT and VTT", () => {
    const result = mergeTranscripts([{ ...pieces[0]!, start: 3_661.5 * SAMPLE_RATE, end: 3_662.25 * SAMPLE_RATE }], 0, "es");
    expect(toSrt(result)).toBe("1\n01:01:01,500 --> 01:01:02,250\nsegunda\n");
    expect(toVtt(result)).toBe("WEBVTT\n\n01:01:01.500 --> 01:01:02.250\nsegunda\n");
  });
});

describe("long-form transcription dispatch", () => {
  const samples = recording([[5, true], [1, false], [5, true]]);
  const twoPieces = [{ start: 0, end: 5 * SAMPLE_RATE }, { start: 6 * SAMPLE_RATE, end: 11 * SAMPLE_RATE }];

  it("retries only explicit pre-dispatch refusals", () => {
    expect(isPreDispatchRefusal({ status: 429, body: { error: { code: "concurrency_limit_exceeded" } } })).toBe(true);
    expect(isPreDispatchRefusal({ status: 429, body: { error: { code: "rate_limit_exceeded" } } })).toBe(true);
    expect(isPreDispatchRefusal({ status: 503, body: { error: { code: "no_capacity" } } })).toBe(true);
    for (const response of [
      { status: 503, body: { error: { code: "dispersion_exhausted" } } },
      { status: 502, body: { error: { code: "settlement_evidence_unavailable" } } },
      { status: 504, body: null },
      { status: 402, body: { error: { code: "insufficient_credits" } } },
    ]) expect(isPreDispatchRefusal(response)).toBe(false);
  });

  it("transcribes every piece with bounded parallelism and dispersion", async () => {
    let active = 0, peak = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const submit: SubmitPiece = async (body) => {
      bodies.push(body);
      active += 1; peak = Math.max(peak, active);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 5));
      active -= 1;
      return transcriptReply(body, `piece ${bodies.length}`);
    };
    const pieces = Array.from({ length: 5 }, () => twoPieces[0]!);
    const done = await runLongTranscription({ samples, pieces, language: "es", parallel: 2,
      dispersionGroup: "lfabcdefabcdefabcdef", deadlineMs: 60_000, submit, sleep: noSleep });
    expect(done.map(piece => piece.index)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(bodies.every(body => (body.dispersion as { group: string }).group === "lfabcdefabcdefabcdef")).toBe(true);
    expect(bodies[0]).toMatchObject({ model: TRANSCRIPTION_MODEL, max_tokens: 1, stream: false });
  });

  it("waits on concurrency refusals and then succeeds", async () => {
    let calls = 0;
    const submit: SubmitPiece = async (body) => (++calls === 1
      ? { status: 429, body: { error: { code: "concurrency_limit_exceeded" } }, retryAfterSeconds: 1 }
      : transcriptReply(body, "hola"));
    const done = await runLongTranscription({ samples, pieces: [twoPieces[0]!], language: "auto", parallel: 1,
      dispersionGroup: null, deadlineMs: 60_000, submit, sleep: noSleep });
    expect(calls).toBe(2);
    expect(done[0]!.text).toBe("hola");
  });

  it("never replays a piece that may have executed and reports completed pieces", async () => {
    const seen: string[] = [];
    const submit: SubmitPiece = async (body) => {
      const content = String((body.messages as Array<{ content: string }>)[0]!.content);
      seen.push(content);
      return seen.length === 1 ? transcriptReply(body, "uno")
        : { status: 502, body: { error: { code: "settlement_evidence_unavailable", message: "no" } } };
    };
    const failure = await runLongTranscription({ samples, pieces: twoPieces, language: "es", parallel: 1,
      dispersionGroup: null, deadlineMs: 60_000, submit, sleep: noSleep }).catch(error => error);
    expect(failure).toBeInstanceOf(LongTranscriptionPieceError);
    expect(failure).toMatchObject({ code: "settlement_evidence_unavailable", statusCode: 502 });
    expect(failure.completed.map((piece: { text: string }) => piece.text)).toEqual(["uno"]);
    expect(seen).toHaveLength(2);
  });

  it("rejects a transcript bound to different audio", async () => {
    const submit: SubmitPiece = async (body) => {
      const reply = transcriptReply(body, "x");
      const choice = (reply.body as { choices: Array<{ message: { content: string } }> }).choices[0]!;
      choice.message.content = choice.message.content.replace(/"audio_sha256":"[a-f0-9]+"/, `"audio_sha256":"${"0".repeat(64)}"`);
      return reply;
    };
    await expect(runLongTranscription({ samples, pieces: [twoPieces[0]!], language: "es", parallel: 1,
      dispersionGroup: null, deadlineMs: 60_000, submit, sleep: noSleep })).rejects.toMatchObject({ code: "transcription_piece_invalid" });
  });

  it("gives up retrying at the job deadline", async () => {
    let clock = 0;
    const submit: SubmitPiece = async () => ({ status: 503, body: { error: { code: "no_capacity" } } });
    await expect(runLongTranscription({ samples, pieces: [twoPieces[0]!], language: "es", parallel: 1,
      dispersionGroup: null, deadlineMs: 5_000, submit, now: () => clock,
      sleep: async (ms) => { clock += ms; } })).rejects.toMatchObject({ code: "no_capacity", statusCode: 503 });
  });
});

describe("long-form transcription route", () => {
  async function app(onChat: (headers: Record<string, unknown>, ip: string, body: Record<string, unknown>) => PieceResponse) {
    const server = Fastify();
    server.post("/v1/chat/completions", async (request, reply) => {
      const response = onChat(request.headers, request.ip, request.body as Record<string, unknown>);
      return reply.code(response.status).send(response.body);
    });
    registerLongFormTranscriptionRoutes(server, { maxSeconds: 120 });
    await server.ready();
    return server;
  }
  const audio = wavFromSamples(recording([[2, false], [20, true], [2, false], [20, true]]));

  it("forwards the caller's credential and address to every piece", async () => {
    const seen: Array<{ authorization: unknown; funding: unknown; ip: string }> = [];
    const server = await app((headers, ip, body) => {
      seen.push({ authorization: headers.authorization, funding: headers["x-mycellios-funding"], ip });
      return transcriptReply(body, `parte ${seen.length}`);
    });
    const response = await server.inject({ method: "POST", url: "/v1/audio/transcriptions/long?language=es&format=srt",
      remoteAddress: "203.0.113.9", headers: { authorization: "Bearer key", "content-type": "audio/wav",
        "x-mycellios-funding": "contribution-credits" }, payload: audio });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("00:00:0");
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every(entry => entry.authorization === "Bearer key" && entry.funding === "contribution-credits"
      && entry.ip === "203.0.113.9")).toBe(true);
    await server.close();
  });

  it("streams segments and a final result as NDJSON", async () => {
    const server = await app((_headers, _ip, body) => transcriptReply(body, "hola"));
    const response = await server.inject({ method: "POST", url: "/v1/audio/transcriptions/long?stream=true",
      headers: { authorization: "Bearer key", "content-type": "audio/wav", "x-mycellios-funding": "contribution-credits" },
      payload: audio });
    const events = response.body.trim().split("\n").map(line => JSON.parse(line) as { type: string; result?: { text: string } });
    expect(events[0]!.type).toBe("accepted");
    expect(events.filter(event => event.type === "segment").length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toMatchObject({ type: "done", result: { text: expect.stringContaining("hola") } });
    await server.close();
  });

  it("refuses missing credentials, funding, silence and oversized recordings before dispatch", async () => {
    let calls = 0;
    const server = await app((_headers, _ip, body) => { calls += 1; return transcriptReply(body, "x"); });
    const send = (headers: Record<string, string>, payload: Buffer, url = "/v1/audio/transcriptions/long") =>
      server.inject({ method: "POST", url, headers: { "content-type": "audio/wav", ...headers }, payload });
    const funded = { authorization: "Bearer key", "x-mycellios-funding": "contribution-credits" };
    expect((await send({}, audio)).statusCode).toBe(401);
    expect((await send({ authorization: "Bearer key" }, audio)).json().error.code).toBe("transcription_funding_required");
    expect((await send(funded, wavFromSamples(recording([[10, false]])))).json().error.code).toBe("transcription_no_speech");
    expect((await send(funded, wavFromSamples(recording([[121, true]])))).statusCode).toBe(413);
    expect((await send(funded, audio, "/v1/audio/transcriptions/long?parallel=99")).statusCode).toBe(400);
    const stereo = Buffer.from(audio); stereo.writeUInt16LE(2, 22);
    expect((await send(funded, stereo)).json().error.code).toBe("transcription_audio_invalid");
    expect(calls).toBe(0);
    await server.close();
  });

  it("returns the failing piece's status with the completed part", async () => {
    let calls = 0;
    const server = await app((_headers, _ip, body) => (++calls === 1 ? transcriptReply(body, "uno")
      : { status: 402, body: { error: { code: "insufficient_credits", message: "Sin créditos" } } }));
    const response = await server.inject({ method: "POST", url: "/v1/audio/transcriptions/long?parallel=1",
      headers: { authorization: "Bearer key", "content-type": "audio/wav", "x-mycellios-funding": "contribution-credits" },
      payload: audio });
    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({ error: { code: "insufficient_credits" }, completed: { text: "uno" } });
    await server.close();
  });
});

describe("long-form transcription in the coordinator", () => {
  it("routes pieces through the real chat path, which enforces transcription funding", async () => {
    process.env.MYCELLIOS_LONG_TRANSCRIPTION_CAPACITY_WAIT_SECONDS = "0";
    const runtime = await createCoordinator({ host: "127.0.0.1", port: 0, requestTimeoutMs: 60000, databasePath: ":memory:",
      allowDevelopmentAdapters: false, mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
      landingAssetsPath: resolve("tests/fixtures/landing-assets") });
    try {
      const audio = wavFromSamples(recording([[5, true]]));
      const unfunded = await runtime.app.inject({ method: "POST", url: "/v1/audio/transcriptions/long",
        headers: { "content-type": "audio/wav" }, payload: audio });
      expect(unfunded.json().error.code).toBe("transcription_funding_required");
      // No replica is connected: the single piece is refused by the real chat path before dispatch.
      const funded = await runtime.app.inject({ method: "POST", url: "/v1/audio/transcriptions/long",
        headers: { "content-type": "audio/wav", "x-mycellios-funding": "contribution-credits" }, payload: audio });
      expect(funded.statusCode).toBeGreaterThanOrEqual(400);
      expect(funded.json()).toMatchObject({ completed: { segments: [] }, total_pieces: 1 });
    } finally {
      delete process.env.MYCELLIOS_LONG_TRANSCRIPTION_CAPACITY_WAIT_SECONDS;
      await runtime.close();
    }
  }, 60_000);
});
