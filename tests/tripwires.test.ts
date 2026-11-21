import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletionRequestSchema } from "../src/contracts/schemas.js";
import { parseEmbeddingRequest } from "../src/contracts/embedding.js";
import { resolveSpeechOptions } from "../src/contracts/speech.js";
import type { ChatCompletionRequest } from "../src/contracts/types.js";
import { createCoordinator, type CoordinatorRuntime } from "../src/coordinator/server.js";
import { Tripwires, type TripwireHit } from "../src/coordinator/tripwires.js";
// @ts-expect-error The bait client is a plain operator script without type declarations.
import * as bait from "../scripts/node-privacy-bait.mjs";

const SECRET = "tripwire-secret-for-tests-0123456789abcdef";
const runtimes: CoordinatorRuntime[] = [];
const folders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.MYCELLIOS_TRIPWIRE_SECRET;
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function tripwires(hits: TripwireHit[] = []): Tripwires {
  return new Tripwires(SECRET, (hit) => hits.push(hit));
}

describe("tripwire tokens (specs/node-owner-privacy D8)", () => {
  it("recognizes links and keys the bait client makes, and nothing else", () => {
    const wires = tripwires();
    const link = bait.tripwireLink(SECRET, "https://www.mycellios.com/");
    const key = bait.tripwireKey(SECRET);
    expect(link.url).toMatch(/^https:\/\/www\.mycellios\.com\/go\/[A-Za-z0-9_-]{33}$/);
    expect(key.key).toMatch(/^myc_live_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{43}$/);
    expect(wires.linkId(link.url.split("/go/")[1]!)).toBe(link.id);
    expect(wires.keyId(key.key)).toBe(key.id);

    const other = new Tripwires("another-secret-that-is-long-enough-123456", () => undefined);
    expect(other.linkId(link.url.split("/go/")[1]!)).toBeNull();
    expect(other.keyId(key.key)).toBeNull();
    expect(wires.keyId(`myc_live_${key.id}_${"A".repeat(43)}`)).toBeNull();
    expect(wires.keyId("myc_live_short")).toBeNull();
    expect(wires.linkId("x".repeat(33))).toBeNull();
  });

  it("is off without a secret and refuses a short one", () => {
    const log = { warn: vi.fn() };
    expect(Tripwires.fromEnvironment({}, log)).toBeNull();
    expect(() => Tripwires.fromEnvironment({ MYCELLIOS_TRIPWIRE_SECRET: "short" }, log)).toThrow();
    expect(Tripwires.fromEnvironment({ MYCELLIOS_TRIPWIRE_SECRET: SECRET }, log)).toBeInstanceOf(Tripwires);
  });

  it("logs a followed bait link and answers like any unknown page", async () => {
    const hits: TripwireHit[] = [];
    const app = Fastify();
    tripwires(hits).register(app);
    const link = bait.tripwireLink(SECRET, "https://example.test");
    const followed = await app.inject({ method: "GET", url: `/go/${link.url.split("/go/")[1]}`,
      headers: { "user-agent": "curl/8", "x-forwarded-for": "203.0.113.9" } });
    const random = await app.inject({ method: "GET", url: `/go/${"a".repeat(33)}` });
    expect(followed.statusCode).toBe(404);
    expect(followed.body).toBe(random.body);
    expect(hits).toEqual([expect.objectContaining({ event: "tripwire_hit", kind: "link", tripwireId: link.id,
      userAgent: "curl/8", forwardedFor: "203.0.113.9" })]);
    await app.close();
  });

  it("reports a bait key tried against the API without changing the answer", async () => {
    process.env.MYCELLIOS_TRIPWIRE_SECRET = SECRET;
    const observe = vi.spyOn(Tripwires.prototype, "observeKey");
    const runtime = await createCoordinator({ host: "127.0.0.1", port: 0, databasePath: ":memory:", requestTimeoutMs: 1_000,
      apiAccessEnabled: true, apiStarterTokens: 10_000 }, { logger: false });
    runtimes.push(runtime);
    const key = bait.tripwireKey(SECRET);
    const response = await runtime.app.inject({ method: "POST", url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${key.key}` },
      payload: { model: "distributed-small", messages: [{ role: "user", content: "hi" }] } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "invalid_api_key" } });
    expect(observe).toHaveBeenCalledWith(key.key, expect.anything());
    const hits: TripwireHit[] = [];
    tripwires(hits).observeKey(key.key, { ip: "198.51.100.4", headers: {} } as never);
    tripwires(hits).observeKey(`myc_live_${"b".repeat(10)}_${"c".repeat(43)}`, { ip: "198.51.100.4", headers: {} } as never);
    expect(hits).toEqual([expect.objectContaining({ kind: "api_key", tripwireId: key.id, ip: "198.51.100.4" })]);
  });
});

describe("bait client", () => {
  const options = { secret: SECRET, linkBase: "https://www.mycellios.com" };

  it("builds speech bait in the shape real voice requests use", () => {
    for (const language of ["es", "en"] as const) {
      const built = bait.buildBait({ ...options, model: bait.KOKORO_MODEL, language });
      const request = chatCompletionRequestSchema.parse(built.request) as ChatCompletionRequest;
      expect(resolveSpeechOptions(request)).toMatchObject({ language });
      const text = request.messages[0]!.content;
      expect(text).toContain(built.phrase);
      expect(text).toContain(`/go/${built.linkId}`);
      expect(text).toMatch(new RegExp(`myc_live_${built.keyId.replace(/[-]/g, "\\-")}_`));
      expect(Object.keys(built.request).sort()).toEqual(["language", "messages", "model", "speed", "stream", "voice"]);
    }
  });

  it("varies its wording so no fixed text marks bait", () => {
    for (const language of ["es", "en"] as const) {
      const markers = { link: "https://x.test/go/L", key: "myc_live_K", phrase: "maple cedar 4242" };
      const texts = Array.from({ length: 300 }, () => bait.baitText(language, markers) as string);
      for (const text of texts) {
        expect(text).toContain(markers.link);
        expect(text).toContain(markers.key);
        expect(text).toContain(markers.phrase);
      }
      expect(new Set(texts).size).toBeGreaterThan(250);
      const firstWords = new Set(texts.map((text) => text.split(" ").slice(0, 2).join(" ")));
      expect(firstWords.size).toBeGreaterThanOrEqual(6);
      const sentences = texts.map((text) => new Set(text.split(/(?<=[.:])\s+/)));
      const shared = [...sentences[0]!].filter((sentence) => sentences.every((set) => set.has(sentence)));
      expect(shared).toEqual([]);
    }
  });

  it("builds embedding bait as the same envelope memory clients send", () => {
    const built = bait.buildBait({ ...options, model: bait.EMBEDDING_MODEL, language: "en", dimensions: 1024 });
    const request = chatCompletionRequestSchema.parse(built.request) as ChatCompletionRequest;
    expect(parseEmbeddingRequest(request)).toMatchObject({ dimensions: 1024, input: [expect.stringContaining(built.phrase)] });
    expect(() => bait.baitRequest("unknown-model", "text")).toThrow();
  });

  it("records each bait privately and finds it again by any of its markers", async () => {
    const folder = mkdtempSync(join(tmpdir(), "bait-"));
    folders.push(folder);
    const records = join(folder, "bait.jsonl");
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const transport = async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ id: "job_bait_1" }), { status: 200 });
    };
    const record = await bait.sendBait({ ...options, coordinator: "https://www.mycellios.com/", apiKey: "myc_live_operator",
      records, model: bait.KOKORO_MODEL, language: "es" }, transport, () => new Date("2026-11-21T00:00:00Z"));
    expect(sent[0]!.url).toBe("https://www.mycellios.com/v1/chat/completions");
    expect((sent[0]!.init.headers as Record<string, string>)["x-mycellios-funding"]).toBe("contribution-credits");
    expect(record).toMatchObject({ jobId: "job_bait_1", status: 200, at: "2026-11-21T00:00:00.000Z" });
    expect(JSON.parse(readFileSync(records, "utf8").trim())).toEqual(record);
    for (const marker of [record.linkId, record.keyId, record.phrase, "job_bait_1"]) {
      expect(bait.lookup(records, marker)).toEqual([record]);
    }
    expect(bait.lookup(records, "unknown")).toEqual([]);
  });
});
