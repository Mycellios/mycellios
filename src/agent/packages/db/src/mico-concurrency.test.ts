import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isServerRoutineRun,
  mainChatCountsTowardLimit,
  routineBrowserRunsOnServer,
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

  it("leaves separate-browser routine turns on the server out of a native Mico's slot", () => {
    const serverRoutine = {
      NOT: {
        trigger: "routine",
        routine: { is: { isolatedBrowser: true } },
        OR: [{ cloudComputerId: { not: null } }, { startedAt: null, checkpoint: null }],
      },
    };
    const pc = { scope: "dedicated", kind: "desktop" };
    for (const agentEngine of ["codex", "claude", "opencode", "acp"]) {
      expect(slotRunsWhere({ agentEngine, mainThreadId: main, computer: pc }, false)).toEqual(serverRoutine);
      expect(slotRunsWhere({ agentEngine, mainThreadId: main, computer: null }, false)).toEqual(serverRoutine);
    }
    expect(slotRunsWhere({ agentEngine: "claude", mainThreadId: main, computer: pc }, true)).toEqual({
      threadId: { not: main },
      ...serverRoutine,
    });
    // Pi already runs them on its own model; an isolated Docker Mico keeps them on its computer.
    expect(slotRunsWhere({ agentEngine: "pi", mainThreadId: main, computer: pc }, false)).toEqual({
      threadId: { not: main },
    });
    expect(
      slotRunsWhere(
        { agentEngine: "claude", mainThreadId: main, computer: { scope: "isolated", kind: "docker" } },
        false,
      ),
    ).toEqual({});
    // A caller that did not read the computer keeps counting them.
    expect(slotRunsWhere({ agentEngine: "claude", mainThreadId: main }, false)).toEqual({});
  });

  it("recognises a separate-browser routine turn that runs or will run on the server", () => {
    const base = {
      trigger: "routine",
      cloudComputerId: null,
      startedAt: null,
      checkpoint: null,
      routine: { isolatedBrowser: true },
    };
    expect(routineBrowserRunsOnServer({ agentEngine: "codex", computer: null })).toBe(true);
    expect(isServerRoutineRun(base)).toBe(true);
    expect(isServerRoutineRun({ ...base, startedAt: new Date(), cloudComputerId: "cloud" })).toBe(true);
    // A turn that already began elsewhere keeps its place.
    expect(isServerRoutineRun({ ...base, startedAt: new Date() })).toBe(false);
    expect(isServerRoutineRun({ ...base, checkpoint: "{}" })).toBe(false);
    expect(isServerRoutineRun({ ...base, routine: { isolatedBrowser: false } })).toBe(false);
    expect(isServerRoutineRun({ ...base, routine: null })).toBe(false);
    expect(isServerRoutineRun({ ...base, trigger: "user" })).toBe(false);
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
