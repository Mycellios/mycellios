import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray) => strings.join(""),
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

import type { Routine } from "@mycellios/contracts";
import { draftFromRoutine, emptyRoutineDraft, emptyWatchDraft, watchFromDraft } from "./RoutineEditor";

describe("routine run place in the editor", () => {
  const routine: Routine = {
    id: "routine-1", botId: "bot-1", name: "Brief", prompt: "Summarize", crons: [], timezone: "UTC",
    active: true, notify: true, webhookEnabled: true, githubEnabled: false, messageProvider: null,
    modelProvider: null, modelId: null, thinkingLevel: null, watch: null, watchState: null,
    lastRunAt: null, nextRunAt: null, createdAt: "2026-11-01T00:00:00.000Z",
  };

  it("offers the switch only for a place a person can choose", () => {
    expect(emptyRoutineDraft().runIn).toBe("thread");
    expect(draftFromRoutine({ ...routine, runIn: "thread" }).runIn).toBe("thread");
    expect(draftFromRoutine({ ...routine, runIn: "chat" }).runIn).toBe("chat");
    expect(draftFromRoutine({ ...routine, runIn: "group" }).runIn).toBeUndefined();
    // An older server does not say where its routines run.
    expect(draftFromRoutine(routine).runIn).toBeUndefined();
  });
});

describe("watchFromDraft", () => {
  it("splits paths by line and drops blanks", () => {
    const result = watchFromDraft({ ...emptyWatchDraft(), paths: " inbox/ \n\nreports/a.csv\n" });
    expect(result).toEqual({
      watch: { kind: "files", everyMinutes: 15, loud: false, paths: ["inbox/", "reports/a.csv"] },
    });
  });

  it("parses tool arguments as a JSON object", () => {
    const draft = { ...emptyWatchDraft(), kind: "tool" as const, tool: "brain_changed" };
    expect(watchFromDraft({ ...draft, args: '{"limit":1}' })).toMatchObject({
      watch: { tool: "brain_changed", args: { limit: 1 } },
    });
    expect(watchFromDraft({ ...draft, args: "[1]" })).toHaveProperty("error");
    expect(watchFromDraft({ ...draft, args: "{nope" })).toHaveProperty("error");
  });

  it("reads tracked fields as a comma list, only for a command or tool", () => {
    const tool = {
      ...emptyWatchDraft(),
      kind: "tool" as const,
      tool: "list_tasks",
      track: " id, date_updated ,",
    };
    expect(watchFromDraft(tool)).toMatchObject({ watch: { track: ["id", "date_updated"] } });
    expect(watchFromDraft({ ...tool, track: "" })).not.toHaveProperty("watch.track");
    const files = { ...emptyWatchDraft(), paths: "inbox/", track: "id" };
    expect(watchFromDraft(files)).not.toHaveProperty("watch.track");
  });

  it("refuses an empty watch", () => {
    expect(watchFromDraft(emptyWatchDraft())).toHaveProperty("error");
    expect(watchFromDraft({ ...emptyWatchDraft(), kind: "command" })).toHaveProperty("error");
  });
});
