/**
 * When to ask for a GitHub star. It is device-local and only appears to someone who keeps
 * coming back: a few separate visits over a few days. "Not now" waits a month; a second
 * "Not now" or opening the repository ends it for good.
 */
export const GITHUB_STAR_PROMPT_KEY = "mycellios.github-star-prompt.v1";
export const MYCELLIOS_REPOSITORY_URL = "https://github.com/Mycellios/mycellios";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Visits closer together than this count as one. */
export const VISIT_GAP_MS = 6 * HOUR;
export const MIN_VISITS = 3;
export const MIN_AGE_MS = 3 * DAY;
export const SNOOZE_MS = 30 * DAY;
const MAX_DISMISSALS = 2;

export type GitHubStarPromptState = {
  firstSeenAt: number;
  lastVisitAt: number;
  visits: number;
  snoozedUntil: number;
  dismissals: number;
  done: boolean;
};

type Store = Pick<Storage, "getItem" | "setItem">;

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function readGitHubStarPrompt(store: Store, now: number): GitHubStarPromptState {
  let saved: Partial<GitHubStarPromptState> = {};
  try {
    const raw = store.getItem(GITHUB_STAR_PROMPT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") saved = parsed as Partial<GitHubStarPromptState>;
  } catch { /* An unreadable value starts over. */ }
  const firstSeenAt = Math.min(finite(saved.firstSeenAt, now), now);
  return {
    firstSeenAt,
    lastVisitAt: Math.min(finite(saved.lastVisitAt, 0), now),
    visits: Math.floor(finite(saved.visits, 0)),
    snoozedUntil: finite(saved.snoozedUntil, 0),
    dismissals: Math.floor(finite(saved.dismissals, 0)),
    done: saved.done === true,
  };
}

function write(store: Store, state: GitHubStarPromptState): GitHubStarPromptState {
  try { store.setItem(GITHUB_STAR_PROMPT_KEY, JSON.stringify(state)); } catch { /* Kept in memory. */ }
  return state;
}

/** Counts this app start as a visit unless the previous one was recent. */
export function recordGitHubStarVisit(store: Store, now: number): GitHubStarPromptState {
  const state = readGitHubStarPrompt(store, now);
  if (state.visits > 0 && now - state.lastVisitAt < VISIT_GAP_MS) return write(store, state);
  return write(store, { ...state, visits: state.visits + 1, lastVisitAt: now });
}

export function gitHubStarPromptDue(state: GitHubStarPromptState, now: number): boolean {
  return !state.done && state.visits >= MIN_VISITS && now - state.firstSeenAt >= MIN_AGE_MS &&
    state.snoozedUntil <= now;
}

export function dismissGitHubStarPrompt(store: Store, now: number): GitHubStarPromptState {
  const state = readGitHubStarPrompt(store, now);
  const dismissals = state.dismissals + 1;
  return write(store, { ...state, dismissals, snoozedUntil: now + SNOOZE_MS, done: dismissals >= MAX_DISMISSALS });
}

export function completeGitHubStarPrompt(store: Store, now: number): GitHubStarPromptState {
  return write(store, { ...readGitHubStarPrompt(store, now), done: true });
}
