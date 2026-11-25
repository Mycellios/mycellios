import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mainChatCountsTowardLimit,
  micoRunsLanes,
  micoTurnLimit,
  nativeConcurrencyEnabled,
  slotRunsWhere,
} from "./mico-concurrency.js";

afterEach(() => vi.unstubAllEnvs());

describe("native concurrency switch", () => {
  it("is off unless the operator sets 1 or true", () => {
    expect(nativeConcurrencyEnabled({})).toBe(false);
    for (const value of ["", "0", "false", "yes", "TRUE", " 1"])
      expect(nativeConcurrencyEnabled({ MYCELLIOS_NATIVE_CONCURRENCY: value })).toBe(false);
    expect(nativeConcurrencyEnabled({ MYCELLIOS_NATIVE_CONCURRENCY: "1" })).toBe(true);
    expect(nativeConcurrencyEnabled({ MYCELLIOS_NATIVE_CONCURRENCY: "true" })).toBe(true);
  });

  it("reads the process environment by default", () => {
    vi.stubEnv("MYCELLIOS_NATIVE_CONCURRENCY", "");
    expect(nativeConcurrencyEnabled()).toBe(false);
    expect(micoTurnLimit({ agentEngine: "codex", taskConcurrency: 4 })).toBe(1);
    vi.stubEnv("MYCELLIOS_NATIVE_CONCURRENCY", "1");
    expect(nativeConcurrencyEnabled()).toBe(true);
    expect(micoTurnLimit({ agentEngine: "codex", taskConcurrency: 4 })).toBe(4);
  });
});

describe("Mico lanes", () => {
  const main = "main-thread";

  it("keeps today's rules while the switch is off", () => {
    expect(micoRunsLanes({ agentEngine: "pi" }, false)).toBe(true);
    expect(micoTurnLimit({ agentEngine: "pi", taskConcurrency: 3 }, false)).toBe(3);
    expect(mainChatCountsTowardLimit({ agentEngine: "pi" }, false)).toBe(false);
    expect(slotRunsWhere({ agentEngine: "pi", mainThreadId: main }, false)).toEqual({
      threadId: { not: main },
    });
    for (const agentEngine of ["codex", "claude", "opencode", "acp"]) {
      expect(micoRunsLanes({ agentEngine }, false)).toBe(false);
      expect(micoTurnLimit({ agentEngine, taskConcurrency: 4 }, false)).toBe(1);
      expect(mainChatCountsTowardLimit({ agentEngine }, false)).toBe(true);
      expect(slotRunsWhere({ agentEngine, mainThreadId: main }, false)).toEqual({});
    }
  });

  it("gives Codex, Claude Code and OpenCode the Pi lanes while it is on", () => {
    for (const agentEngine of ["pi", "codex", "claude", "opencode"]) {
      expect(micoRunsLanes({ agentEngine }, true)).toBe(true);
      expect(micoTurnLimit({ agentEngine, taskConcurrency: 2 }, true)).toBe(2);
      expect(mainChatCountsTowardLimit({ agentEngine }, true)).toBe(false);
      expect(slotRunsWhere({ agentEngine, mainThreadId: main }, true)).toEqual({
        threadId: { not: main },
      });
      // Without a main chat every turn uses a slot.
      expect(slotRunsWhere({ agentEngine, mainThreadId: null }, true)).toEqual({});
    }
  });

  it("keeps a generic ACP agent and unknown engines at one turn in total", () => {
    for (const agentEngine of ["acp", "unknown"]) {
      expect(micoRunsLanes({ agentEngine }, true)).toBe(false);
      expect(micoTurnLimit({ agentEngine, taskConcurrency: 4 }, true)).toBe(1);
      expect(mainChatCountsTowardLimit({ agentEngine }, true)).toBe(true);
      expect(slotRunsWhere({ agentEngine, mainThreadId: main }, true)).toEqual({});
    }
  });
});
