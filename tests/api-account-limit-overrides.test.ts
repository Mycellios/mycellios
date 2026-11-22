import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatCompletionRequest } from "../src/contracts/types.js";
import { ApiAccessManager, fileAccountLimitOverrides } from "../src/coordinator/api-access.js";
import { MeshDatabase } from "../src/storage/database.js";

const request: ChatCompletionRequest = { model: "m", messages: [{ role: "user", content: "hola" }], max_tokens: 1, stream: false };
const USER = "3374389b-81e1-46a6-a79d-4569120c5e3b";
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("per-account API limit overrides", () => {
  it("raises only the approved account's concurrency", async () => {
    const database = await MeshDatabase.open(":memory:");
    const access = new ApiAccessManager(database, { starterTokens: 1_000, requestsPerMinute: 30, maxConcurrent: 1, maxActiveKeys: 2 },
      {}, false, () => ({ [USER]: { maxConcurrent: 3 } }));
    expect(access.limitsFor(USER)).toEqual({ maxConcurrent: 3, requestsPerMinute: 30 });
    expect(access.limitsFor("other")).toEqual({ maxConcurrent: 1, requestsPerMinute: 30 });
    for (let index = 0; index < 3; index += 1) await access.beginUsage(USER, null, request);
    await expect(access.beginUsage(USER, null, request)).rejects.toMatchObject({ code: "concurrency_limit_exceeded" });
    await access.beginUsage("other", null, request);
    await expect(access.beginUsage("other", null, request)).rejects.toMatchObject({ code: "concurrency_limit_exceeded" });
    await database.close();
  });

  it("never lowers shared limits through an override", () => {
    const access = new ApiAccessManager({} as MeshDatabase, { starterTokens: 1, requestsPerMinute: 30, maxConcurrent: 2, maxActiveKeys: 1 },
      {}, false, () => ({ [USER]: { maxConcurrent: 1, requestsPerMinute: 5 } }));
    expect(access.limitsFor(USER)).toEqual({ maxConcurrent: 2, requestsPerMinute: 30 });
  });

  it("reads audited overrides from a file and keeps the last valid copy after a bad edit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mycellios-limits-"));
    cleanup.push(directory);
    const path = join(directory, "api-account-limits.json");
    let clock = 0;
    const read = fileAccountLimitOverrides(path, () => clock);
    expect(read()).toEqual({});
    await writeFile(path, JSON.stringify({ schema: "mycellios-api-account-limits/1", accounts: { [USER]: {
      maxConcurrent: 16, requestsPerMinute: 600, approvedBy: "operator", approvedAt: "2026-11-21T12:00:00Z", reason: "Speakr without queues" } } }));
    clock += 10_000;
    expect(read()).toEqual({ [USER]: { maxConcurrent: 16, requestsPerMinute: 600 } });
    await writeFile(path, "{not json");
    clock += 10_000;
    expect(read()).toEqual({ [USER]: { maxConcurrent: 16, requestsPerMinute: 600 } });
    await writeFile(path, JSON.stringify({ schema: "mycellios-api-account-limits/1", accounts: { [USER]: { maxConcurrent: 500,
      approvedBy: "x", approvedAt: "2026-11-21T12:00:00Z", reason: "too high" } } }));
    clock += 10_000;
    expect(read()[USER]).toEqual({ maxConcurrent: 16, requestsPerMinute: 600 });
  });
});
