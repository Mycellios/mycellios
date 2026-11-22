import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEnv, legacyEnvName, readEnv } from "./legacy-env.js";

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
