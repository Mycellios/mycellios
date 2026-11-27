import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LocalModels, estimatedSpeed, hardwareProfile, localModelSpec, modelFit, parseDevices, recommendModels,
} from "./local-models.js";
import manifest from "./local-models.json" with { type: "json" };

const GiB = 1024 ** 3;
const laptop890M = hardwareProfile(parseDevices("Available devices:\n  Vulkan0: AMD Radeon(TM) 890M Graphics (16444 MiB, 15622 MiB free)\n"), 32 * GiB);

function choices(hardware: ReturnType<typeof hardwareProfile>) {
  return manifest.models.map((model) => {
    const speed = estimatedSpeed(model, hardware);
    return { id: model.id, bytes: model.bytes, fit: modelFit(model, hardware, speed) };
  });
}

describe("local model hardware", () => {
  it("reads the devices the engine lists", () => {
    expect(parseDevices([
      "Available devices:",
      "  Vulkan0: AMD Radeon(TM) 890M Graphics (16444 MiB, 15622 MiB free)",
      "  CUDA0: NVIDIA GeForce RTX 3060 (12288 MiB, 11000 MiB free)",
      "  MTL0: Apple M2 (10922 MiB, 10922 MiB free)",
    ].join("\n"))).toEqual([
      { name: "AMD Radeon(TM) 890M Graphics", memoryMiB: 16444, kind: "integrated" },
      { name: "NVIDIA GeForce RTX 3060", memoryMiB: 12288, kind: "discrete" },
      { name: "Apple M2", memoryMiB: 10922, kind: "apple" },
    ]);
  });

  it("puts machines in tiers", () => {
    expect(laptop890M.tier).toBe("integrated");
    expect(hardwareProfile(parseDevices("CUDA0: NVIDIA GeForce RTX 4060 (8188 MiB, 7000 MiB free)"), 16 * GiB).tier).toBe("strong");
    expect(hardwareProfile([], 8 * GiB).tier).toBe("weak");
  });
});

describe("speed-first recommendation", () => {
  it("picks the 2B model on an integrated Radeon 890M, as measured, with gpt-oss as the smarter option", () => {
    expect(recommendModels(choices(laptop890M))).toEqual({ recommended: "qwen3.5-2b", smarter: "gpt-oss-20b" });
  });

  it("picks a larger fast model on a discrete GPU and refuses models that do not fit", () => {
    const rtx3060 = hardwareProfile(parseDevices("CUDA0: NVIDIA GeForce RTX 3060 (12288 MiB, 11000 MiB free)"), 32 * GiB);
    const fits = Object.fromEntries(choices(rtx3060).map((choice) => [choice.id, choice.fit]));
    expect(fits["gpt-oss-20b"]).toBe("too-large");
    expect(recommendModels(choices(rtx3060)).recommended).toBe("qwen3.5-4b");
  });

  it("falls back to the smallest model on a CPU-only PC", () => {
    expect(recommendModels(choices(hardwareProfile([], 16 * GiB))).recommended).toBe("qwen3.5-0.8b");
  });

  it("recommends nothing when no model meets the speed floor", () => {
    expect(recommendModels([{ id: "a", bytes: 1, fit: "slower" }, { id: "b", bytes: 2, fit: "very-slow" }])).toEqual({ recommended: undefined, smarter: "a" });
  });

  it("uses this PC's measured speed over the estimate", () => {
    const model = localModelSpec("qwen3.5-4b");
    expect(modelFit(model, laptop890M, { prefill: 160, generation: 8, measured: true })).toBe("very-slow");
    expect(modelFit(model, laptop890M, { prefill: 900, generation: 26, measured: true })).toBe("fast");
  });

  it("rejects unknown models", () => {
    expect(() => localModelSpec("../../etc")).toThrow("Unknown local model");
  });
});

describe("verified model downloads", () => {
  let directory: string;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  type Downloader = { download(url: string, target: string, file: { bytes: number; sha256: string }, signal: AbortSignal): Promise<void> };
  const body = Buffer.from("pinned model bytes for the test");
  const file = { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };

  function server(requests: (string | null)[], payload = body) {
    return (async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      requests.push(range);
      const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      return new Response(payload.subarray(start), { status: range ? 206 : 200 });
    }) as typeof fetch;
  }

  it("resumes a partial download with a range request and verifies the whole file", async () => {
    directory = await mkdtemp(join(tmpdir(), "local-models-"));
    const target = join(directory, "models", "model.gguf");
    await mkdir(join(directory, "models"));
    await writeFile(`${target}.partial`, body.subarray(0, 10));
    const requests: (string | null)[] = [];
    const models = new LocalModels(directory, server(requests)) as unknown as Downloader;
    await models.download("https://example.invalid/model.gguf", target, file, new AbortController().signal);
    expect(requests).toEqual(["bytes=10-"]);
    expect(await readFile(target)).toEqual(body);
  });

  it("deletes a download whose hash does not match and never installs it", async () => {
    directory = await mkdtemp(join(tmpdir(), "local-models-"));
    const target = join(directory, "models", "model.gguf");
    const tampered = Buffer.from(body); tampered[0] = 0;
    const models = new LocalModels(directory, server([], tampered)) as unknown as Downloader;
    await expect(models.download("https://example.invalid/model.gguf", target, file, new AbortController().signal)).rejects.toThrow("failed verification");
    await expect(stat(target)).rejects.toThrow();
    await expect(stat(`${target}.partial`)).rejects.toThrow();
  });

  it("refuses a download larger than the pinned size", async () => {
    directory = await mkdtemp(join(tmpdir(), "local-models-"));
    const target = join(directory, "models", "model.gguf");
    const models = new LocalModels(directory, server([], Buffer.concat([body, body]))) as unknown as Downloader;
    await expect(models.download("https://example.invalid/model.gguf", target, file, new AbortController().signal)).rejects.toThrow();
    await expect(stat(target)).rejects.toThrow();
  });
});
