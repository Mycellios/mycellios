import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./zod-config";

describe("zod config", () => {
  it("keeps Zod from compiling parsers with eval", () => {
    expect(z.config().jitless).toBe(true);
    expect(z.object({ a: z.string() }).parse({ a: "x" })).toEqual({ a: "x" });
  });
});
