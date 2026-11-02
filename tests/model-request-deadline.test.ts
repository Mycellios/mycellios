import { describe, expect, it } from "vitest";
import { modelRequestTimeout, parseModelRequestTimeouts, withModelRequestDeadline } from "../src/core/model-request-deadline.js";

describe("operator model request deadlines", () => {
  const budgets = { "native-chat": 900_000 };
  it("only defaults the named model and leaves the original request intact", () => {
    const input = { model: "native-chat", messages: [] };
    expect(withModelRequestDeadline(input, budgets)).toEqual({ ...input, deadline_ms: 900_000 });
    expect(input).not.toHaveProperty("deadline_ms");
    for (const model of ["kokoro", "embeddings"]) {
      const other = { model, messages: [] };
      expect(withModelRequestDeadline(other, budgets)).toBe(other);
      expect(modelRequestTimeout(model, budgets, 120_000)).toBe(120_000);
    }
    expect(modelRequestTimeout("native-chat", budgets, 120_000)).toBe(900_000);
  });
  it("preserves explicit client deadlines and does not bypass request validation", () => {
    for (const deadline_ms of [10_000, null, "invalid"]) {
      const input = { model: "native-chat", deadline_ms };
      expect(withModelRequestDeadline(input, budgets)).toBe(input);
    }
    expect(withModelRequestDeadline(null, budgets)).toBeNull();
    expect(withModelRequestDeadline([], budgets)).toEqual([]);
  });
  it("validates bounded numeric operator budgets and rejects prototype keys", () => {
    expect(parseModelRequestTimeouts(undefined)).toEqual({});
    expect(parseModelRequestTimeouts(JSON.stringify(budgets))).toEqual(budgets);
    for (const input of ['[]', 'null', '{"m":999}', '{"m":3600001}', '{"m":"900000"}', '{"__proto__":900000}']) {
      expect(() => parseModelRequestTimeouts(input)).toThrow();
    }
    expect(modelRequestTimeout("toString", {}, 120_000)).toBe(120_000);
  });
});
