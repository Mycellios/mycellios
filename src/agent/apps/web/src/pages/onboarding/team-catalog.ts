import { BOT_INSTRUCTIONS_MAX_LENGTH, FIRST_MICO_SPAWN_KEY } from "@rakazo/contracts";

export const TEAM_SECTORS = [
  "sales",
  "seo",
  "support",
  "research",
  "marketing",
  "operations",
] as const;
export type TeamSector = (typeof TEAM_SECTORS)[number];
export const TEAM_AUDIENCES = ["me", "team", "customers"] as const;
export type TeamAudience = (typeof TEAM_AUDIENCES)[number];
export const TEAM_STARTS = ["research", "drafts", "process"] as const;
export type TeamStart = (typeof TEAM_STARTS)[number];
export const TEAM_MEMBER_IDS = [
  "sales-research",
  "sales-outreach",
  "sales-followup",
  "seo-research",
  "seo-editor",
  "seo-technical",
  "support-triage",
  "support-reply",
  "support-knowledge",
  "research-gather",
  "research-check",
  "research-brief",
  "marketing-plan",
  "marketing-copy",
  "marketing-analyst",
  "operations-coordinator",
  "operations-process",
  "operations-tracker",
] as const;
export type TeamMemberId = (typeof TEAM_MEMBER_IDS)[number];

const ROSTERS: Record<TeamSector, readonly TeamMemberId[]> = {
  sales: ["sales-research", "sales-outreach", "sales-followup"],
  seo: ["seo-research", "seo-editor", "seo-technical"],
  support: ["support-triage", "support-reply", "support-knowledge"],
  research: ["research-gather", "research-check", "research-brief"],
  marketing: ["marketing-plan", "marketing-copy", "marketing-analyst"],
  operations: ["operations-coordinator", "operations-process", "operations-tracker"],
};

export class TeamCreditsError extends Error {
  constructor() {
    super("Mycellios credits are unavailable");
    this.name = "TeamCreditsError";
  }
}

export type TeamAnswers = {
  sector?: TeamSector | null;
  audience?: TeamAudience | null;
  start?: TeamStart | null;
};

/** Explicit choices keep setup free and avoid guessing intent from keywords. */
export function questionsFor(): Array<"sector" | "audience" | "start"> {
  return ["sector", "audience", "start"];
}

export function proposeTeam(answers: TeamAnswers = {}) {
  const sector = answers.sector ?? "operations";
  return {
    sector,
    members: [...ROSTERS[sector]],
    audience: answers.audience ?? "me",
    start: answers.start ?? "drafts",
  };
}

export function memberSpawnKey(id: TeamMemberId, lead: boolean): string {
  return lead ? FIRST_MICO_SPAWN_KEY : `onboarding:team:${id}`;
}

export function memberInstructions(input: {
  line: string;
  description: string;
  audience: string;
  start: string;
}): string {
  const need = input.description.trim().slice(0, 2000);
  return [
    input.line,
    need ? `The user described the work as: ${need}` : "",
    `This is for: ${input.audience}.`,
    `They want the team to start by: ${input.start}.`,
    "Work only inside the requested scope and existing permissions.",
    "Draft work for the user to review.",
    "Do not send messages, publish, spend, delete, or expand permissions without an explicit request.",
    "Distinguish facts, hypotheses, and unverified outcomes.",
    "Reply in the user's language.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, BOT_INSTRUCTIONS_MAX_LENGTH);
}
