import { describe, expect, it, vi } from "vitest";
import { callNoticeSpeech, callNotices } from "./call-notices";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

const since = Date.parse("2026-11-27T10:00:00Z");

function run(overrides: Partial<Parameters<typeof callNotices>[0][number]> = {}) {
  return {
    runId: "run-1",
    botName: "Bruno",
    groupId: null,
    groupName: null,
    threadId: "thread-other",
    status: "completed" as const,
    trigger: "user" as const,
    notificationsEnabled: true,
    updatedAt: "2026-11-27T10:01:00Z",
    ...overrides,
  };
}

describe("callNotices", () => {
  const options = { since, callThreadId: "thread-call", seen: new Set<string>() };

  it("reports other work that finished, failed or waits since the call started", () => {
    expect(
      callNotices(
        [
          run(),
          run({ runId: "run-2", botName: "Carla", status: "failed" }),
          run({ runId: "run-3", botName: "Dani", status: "waiting_input" }),
        ],
        options,
      ),
    ).toEqual([
      { key: "run-1:completed", name: "Bruno", kind: "finished" },
      { key: "run-2:failed", name: "Carla", kind: "failed" },
      { key: "run-3:waiting_input", name: "Dani", kind: "waiting" },
    ]);
  });

  it("keeps quiet about the call itself, old or muted work and quiet finishes", () => {
    expect(
      callNotices(
        [
          run({ threadId: "thread-call" }),
          run({ runId: "old", updatedAt: "2026-11-27T09:59:00Z" }),
          run({ runId: "muted", notificationsEnabled: false }),
          run({ runId: "routine", trigger: "routine" }),
          run({ runId: "teammate", trigger: "bot_message" }),
          run({ runId: "running", status: "running" }),
        ],
        options,
      ),
    ).toEqual([]);
    // A teammate-started turn that fails or asks still counts.
    expect(
      callNotices([run({ trigger: "delegated_task", status: "failed" })], options),
    ).toHaveLength(1);
  });

  it("announces each change once and names groups by the group", () => {
    const seen = new Set(["run-1:completed"]);
    expect(callNotices([run(), run()], { ...options, seen })).toEqual([]);
    expect(
      callNotices(
        [
          run({ runId: "g", groupId: "group-1", groupName: "Equipo" }),
          run({ runId: "g", groupId: "group-1", groupName: "Equipo" }),
        ],
        options,
      ),
    ).toEqual([{ key: "g:completed", name: "Equipo", kind: "finished" }]);
  });
});

describe("callNoticeSpeech", () => {
  it("puts what waits for the caller first and lists a few names", () => {
    expect(
      callNoticeSpeech([
        { key: "a", name: "Bruno", kind: "finished" },
        { key: "b", name: "Carla", kind: "waiting" },
      ]),
    ).toBe("Heads up: Carla is waiting for you. Bruno finished.");
    expect(
      callNoticeSpeech(
        ["A", "B", "C", "D"].map((name) => ({ key: name, name, kind: "finished" as const })),
      ),
    ).toBe("A, B, C and others finished.");
  });
});
