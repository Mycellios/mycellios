import { afterEach, expect, it } from "vitest";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { parseOperatorQuotaModels } from "../src/core/operator-quota-config.js";
import { MeshDatabase } from "../src/storage/database.js";
const databases: MeshDatabase[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const request = { model: "kokoro", messages: [{ role: "user" as const, content: "Hola" }], max_tokens: 1 };
const limits = { starterTokens: 0, requestsPerMinute: 3, maxConcurrent: 1, maxActiveKeys: 3 };
it("runs only the configured key/model with zero quota, preserves usage and persists its funding decision", () => {
  const db = new MeshDatabase(":memory:"); databases.push(db);
  const plain = new ApiAccessManager(db, limits);
  const key = plain.createKey("owner", "seller");
  const other = plain.createKey("owner", "other app");
  const access = new ApiAccessManager(db, limits, { [key.id]: ["kokoro"] });
  expect(() => access.beginUsage("owner", null, request)).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  expect(() => access.beginUsage("owner", other.id, request)).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  expect(() => access.beginUsage("owner", key.id, { ...request, model: "paid-llm" })).toThrowError(expect.objectContaining({ code: "insufficient_token_balance" }));
  const usage = access.beginUsage("owner", key.id, request);
  expect(usage.reservedTokens).toBe(0);
  expect(() => access.beginUsage("owner", key.id, request)).toThrowError(expect.objectContaining({ code: "concurrency_limit_exceeded" }));
  // A restarted manager without the policy must honor the original persisted reservation.
  const restarted = new ApiAccessManager(db, limits);
  expect(restarted.completeUsage(usage.id, 17, 0)).toMatchObject({ tokenBalance: 0, lifetimeInputTokens: 17, requestCount: 1 });
  expect(restarted.completeUsage(usage.id, 17, 0)).toBeNull();
  const failed = access.beginUsage("owner", key.id, request);
  expect(access.failUsage(failed.id, "offline")).toMatchObject({ tokenBalance: 0 });
  const last = access.beginUsage("owner", key.id, request); access.completeUsage(last.id, 5, 0);
  expect(() => access.beginUsage("owner", key.id, request)).toThrowError(expect.objectContaining({ code: "rate_limit_exceeded" }));
  expect(access.revokeKey("owner", key.id)).toBe(true); expect(access.authenticateKey(key.secret)).toBeNull();
});
it("fails closed on malformed operator configuration", () => {
  expect(parseOperatorQuotaModels(undefined)).toEqual({});
  expect(parseOperatorQuotaModels('{"key_1":["kokoro"]}')).toEqual({ key_1: ["kokoro"] });
  for (const value of ["[]", "null", '{"key_1":[]}', '{"key_1":[1]}', '{"key_1":"kokoro"}']) expect(() => parseOperatorQuotaModels(value)).toThrow();
});
