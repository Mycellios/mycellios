import { afterEach, expect, it } from "vitest";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { parseOperatorQuotaModels } from "../src/core/operator-quota-config.js";
import { MeshDatabase } from "../src/storage/database.js";
const databases: MeshDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) (await db.close()); });
const request = { model: "kokoro", messages: [{ role: "user" as const, content: "Hola" }], max_tokens: 1 };
const limits = { starterTokens: 0, requestsPerMinute: 3, maxConcurrent: 1, maxActiveKeys: 3 };
it("runs only the configured key/model with zero quota, preserves usage and persists its funding decision", async () => {
  const db = (await MeshDatabase.open(":memory:")); databases.push(db);
  const plain = new ApiAccessManager(db, limits);
  const key = (await plain.createKey("owner", "seller"));
  const other = (await plain.createKey("owner", "other app"));
  const access = new ApiAccessManager(db, limits, { [key.id]: ["kokoro"] });
  expect(async () => (await access.beginUsage("owner", null, request))).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  expect(async () => (await access.beginUsage("owner", other.id, request))).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  expect(async () => (await access.beginUsage("owner", key.id, { ...request, model: "paid-llm" }))).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  const usage = (await access.beginUsage("owner", key.id, request));
  expect(usage.reservedTokens).toBe(0);
  expect(async () => (await access.beginUsage("owner", key.id, request))).toThrowError(expect.objectContaining({ code: "concurrency_limit_exceeded" }));
  // A restarted manager without the policy must honor the original persisted reservation.
  const restarted = new ApiAccessManager(db, limits);
  expect((await restarted.completeUsage(usage.id, 17, 0))).toMatchObject({ tokenBalance: 0, lifetimeInputTokens: 17, requestCount: 1 });
  expect((await restarted.completeUsage(usage.id, 17, 0))).toBeNull();
  const failed = (await access.beginUsage("owner", key.id, request));
  expect((await access.failUsage(failed.id, "offline"))).toMatchObject({ tokenBalance: 0 });
  const last = (await access.beginUsage("owner", key.id, request)); (await access.completeUsage(last.id, 5, 0));
  expect(async () => (await access.beginUsage("owner", key.id, request))).toThrowError(expect.objectContaining({ code: "rate_limit_exceeded" }));
  expect((await access.revokeKey("owner", key.id))).toBe(true); expect((await access.authenticateKey(key.secret))).toBeNull();
});
it("fails closed on malformed operator configuration", () => {
  expect(parseOperatorQuotaModels(undefined)).toEqual({});
  expect(parseOperatorQuotaModels('{"key_1":["kokoro"]}')).toEqual({ key_1: ["kokoro"] });
  for (const value of ["[]", "null", '{"key_1":[]}', '{"key_1":[1]}', '{"key_1":"kokoro"}']) expect(() => parseOperatorQuotaModels(value)).toThrow();
});
