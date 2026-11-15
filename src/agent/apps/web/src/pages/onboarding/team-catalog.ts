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

const KEYWORDS: Record<TeamSector, readonly string[]> = {
  sales: [
    "sales",
    "sale",
    "venta",
    "ventas",
    "leads",
    "lead",
    "pipeline",
    "outreach",
    "prospect",
    "crm",
    "comercial",
  ],
  seo: ["seo", "keyword", "keywords", "ranking", "posicionamiento", "search console"],
  support: [
    "support",
    "soporte",
    "ticket",
    "tickets",
    "helpdesk",
    "inbox",
    "atencion",
    "help desk",
  ],
  research: ["research", "investig", "fuente", "fuentes", "competitive", "competencia", "brief"],
  marketing: ["marketing", "campaign", "campana", "anuncio", "anuncios", "social media"],
  operations: ["operation", "operacion", "proceso", "process", "workflow", "ops"],
};

export class TeamCreditsError extends Error {
  constructor() {
    super("Mycellios credits are unavailable");
    this.name = "TeamCreditsError";
  }
}

export function normalizeNeed(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function keywordAt(text: string, keyword: string): number {
  const pattern = keyword.length > 4 ? keyword : `(?:^|[^a-z0-9])${keyword}(?:$|[^a-z0-9])`;
  const match = new RegExp(pattern).exec(text);
  return match ? match.index : -1;
}

export function inferSector(description: string): TeamSector | null {
  const text = normalizeNeed(description);
  if (!text.trim()) return null;
  let best: { sector: TeamSector; score: number; at: number } | null = null;
  for (const sector of TEAM_SECTORS) {
    let score = 0;
    let at = Number.POSITIVE_INFINITY;
    for (const keyword of KEYWORDS[sector]) {
      const index = keywordAt(text, keyword);
      if (index < 0) continue;
      score += 1;
      if (index < at) at = index;
    }
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && at < best.at))
      best = { sector, score, at };
  }
  return best?.sector ?? null;
}

export type TeamAnswers = {
  sector?: TeamSector | null;
  audience?: TeamAudience | null;
  start?: TeamStart | null;
};

export function questionsFor(description: string): Array<"sector" | "audience" | "start"> {
  return inferSector(description) ? ["audience", "start"] : ["sector", "start"];
}

export function proposeTeam(description: string, answers: TeamAnswers = {}) {
  const sector = answers.sector ?? inferSector(description) ?? "operations";
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
