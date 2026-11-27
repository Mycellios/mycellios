import { describe, expect, it } from "vitest";
import {
  completeGitHubStarPrompt,
  dismissGitHubStarPrompt,
  GITHUB_STAR_PROMPT_KEY,
  gitHubStarPromptDue,
  MIN_AGE_MS,
  readGitHubStarPrompt,
  recordGitHubStarVisit,
  SNOOZE_MS,
  VISIT_GAP_MS,
} from "./github-star-prompt";

function memoryStore(initial?: string) {
  const values = new Map<string, string>(initial ? [[GITHUB_STAR_PROMPT_KEY, initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

/** Three visits spread over the minimum age, so the prompt is due at `end`. */
function settledStore() {
  const store = memoryStore();
  const start = 1_000_000;
  recordGitHubStarVisit(store, start);
  recordGitHubStarVisit(store, start + VISIT_GAP_MS);
  const end = start + MIN_AGE_MS;
  recordGitHubStarVisit(store, end);
  return { store, end };
}

describe("GitHub star prompt", () => {
  it("never asks on a first visit or before a few separate visits", () => {
    const store = memoryStore();
    expect(gitHubStarPromptDue(recordGitHubStarVisit(store, 0), MIN_AGE_MS)).toBe(false);
    // Reloads close together are one visit.
    recordGitHubStarVisit(store, 60_000);
    recordGitHubStarVisit(store, 120_000);
    expect(readGitHubStarPrompt(store, 120_000).visits).toBe(1);
  });

  it("asks a returning person after enough days", () => {
    const { store, end } = settledStore();
    expect(gitHubStarPromptDue(readGitHubStarPrompt(store, end), end)).toBe(true);
  });

  it("waits a month after Not now and stops after the second one", () => {
    const { store, end } = settledStore();
    expect(gitHubStarPromptDue(dismissGitHubStarPrompt(store, end), end + 1)).toBe(false);
    const later = end + SNOOZE_MS;
    expect(gitHubStarPromptDue(readGitHubStarPrompt(store, later), later)).toBe(true);
    expect(dismissGitHubStarPrompt(store, later).done).toBe(true);
    expect(gitHubStarPromptDue(readGitHubStarPrompt(store, later * 2), later * 2)).toBe(false);
  });

  it("never asks again after opening GitHub", () => {
    const { store, end } = settledStore();
    expect(completeGitHubStarPrompt(store, end).done).toBe(true);
    expect(gitHubStarPromptDue(readGitHubStarPrompt(store, end + SNOOZE_MS), end + SNOOZE_MS)).toBe(false);
  });

  it("starts over from an unreadable value", () => {
    const state = readGitHubStarPrompt(memoryStore("{not json"), 5);
    expect(state).toMatchObject({ firstSeenAt: 5, visits: 0, done: false });
  });
});
