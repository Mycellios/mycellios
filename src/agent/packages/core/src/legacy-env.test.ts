import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConflictingHeaderError,
  deleteEnv,
  HEADER_PREFIX,
  legacyEnvName,
  legacyHeaderName,
  readEnv,
  readHeader,
} from "./legacy-env.js";

afterEach(() => vi.restoreAllMocks());

describe("readEnv", () => {
  it("prefers the current name", () => {
    const source = { MYCELLIOS_PROBE_A: "new", [legacyEnvName("PROBE_A")]: "old" };
    expect(readEnv("PROBE_A", source)).toBe("new");
  });

  it("falls back to the legacy name and reports it once without the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = { [legacyEnvName("PROBE_B")]: "secret-value" };
    expect(readEnv("PROBE_B", source)).toBe("secret-value");
    expect(readEnv("PROBE_B", source)).toBe("secret-value");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("MYCELLIOS_PROBE_B");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("secret-value");
  });

  it("keeps an empty current value instead of falling back", () => {
    const source = { MYCELLIOS_PROBE_C: "", [legacyEnvName("PROBE_C")]: "old" };
    expect(readEnv("PROBE_C", source)).toBe("");
  });

  it("returns undefined when neither name is set", () => {
    expect(readEnv("PROBE_D", {})).toBeUndefined();
  });
});

describe("deleteEnv", () => {
  it("removes both spellings", () => {
    const target: Record<string, string | undefined> = { MYCELLIOS_PROBE_E: "a", [legacyEnvName("PROBE_E")]: "b", OTHER: "c" };
    deleteEnv("PROBE_E", target);
    expect(target).toEqual({ OTHER: "c" });
  });
});

describe("readHeader", () => {
  const from = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

  it("reads the current header, then the legacy one", () => {
    expect(readHeader(from({ [`${HEADER_PREFIX}space-id`]: "a" }), "space-id")).toBe("a");
    expect(readHeader(from({ [legacyHeaderName("space-id")]: "b" }), "space-id")).toBe("b");
    expect(readHeader(from({}), "space-id")).toBeUndefined();
  });

  it("accepts both when they agree and refuses them when they differ", () => {
    const current = `${HEADER_PREFIX}space-id`;
    const legacy = legacyHeaderName("space-id");
    expect(readHeader(from({ [current]: "a", [legacy]: "a" }), "space-id")).toBe("a");
    expect(() => readHeader(from({ [current]: "a", [legacy]: "b" }), "space-id")).toThrow(
      ConflictingHeaderError,
    );
  });
});
