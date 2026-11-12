import { describe, expect, it } from "vitest";
import {
  getToolActivityEnabled,
  normalizeToolActivityPreference,
  persistToolActivityPreference,
  resolveToolActivityPreference,
  TOOL_ACTIVITY_STORAGE_KEY,
} from "./tool-activity-preference";

describe("tool activity preference", () => {
  it("keeps steps folded unless expanded is saved", () => {
    expect(normalizeToolActivityPreference("on")).toBe("on");
    expect(normalizeToolActivityPreference("ON")).toBe("on");
    expect(normalizeToolActivityPreference(" on ")).toBe("on");
    expect(normalizeToolActivityPreference("expanded")).toBe("expanded");
    expect(normalizeToolActivityPreference("off")).toBe("on");
    expect(normalizeToolActivityPreference("OFF")).toBe("on");
    expect(normalizeToolActivityPreference(null)).toBe("on");
    expect(normalizeToolActivityPreference(undefined)).toBe("on");
    expect(normalizeToolActivityPreference("")).toBe("on");
    expect(normalizeToolActivityPreference("nonsense")).toBe("on");
  });

  it("resolves from an explicit stored value", () => {
    expect(resolveToolActivityPreference({ stored: "off" })).toBe("on");
    expect(resolveToolActivityPreference({ stored: "on" })).toBe("on");
    expect(resolveToolActivityPreference({ stored: null })).toBe("on");
  });

  it("persists through storage helpers and reads it back", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    persistToolActivityPreference("off", storage);
    expect(store.get(TOOL_ACTIVITY_STORAGE_KEY)).toBe("off");
    expect(resolveToolActivityPreference({ storage })).toBe("on");
    persistToolActivityPreference("on", storage);
    expect(resolveToolActivityPreference({ storage })).toBe("on");
  });

  it("keeps steps folded when storage is unreadable or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(resolveToolActivityPreference({ storage: throwing })).toBe("on");
    expect(resolveToolActivityPreference({ storage: null })).toBe("on");
    expect(() => persistToolActivityPreference("off", throwing)).not.toThrow();
  });

  it("keeps steps available by default", () => {
    expect(getToolActivityEnabled()).toBe(true);
  });
});
