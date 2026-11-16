import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOT_INSTRUCTIONS_MAX_LENGTH, FIRST_MICO_SPAWN_KEY } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { draftOnboardingTeam } from "./create-onboarding-team";
import {
  memberInstructions,
  proposeTeam,
  questionsFor,
  TEAM_SECTORS,
} from "./team-catalog";

const copy = {
  member: (id: string) => ({ name: id, line: `${id} duty` }),
  audience: "Just me",
  start: "Draft work for me to review",
};

describe("team catalog", () => {
  it("asks structured questions without guessing or calling a model", () => {
    expect(questionsFor()).toEqual(["sector", "audience", "start"]);
  });

  it("proposes the role roster and keeps the user's answers", () => {
    expect(proposeTeam({ sector: "sales", audience: "customers", start: "process" })).toEqual({
      sector: "sales",
      members: ["sales-research", "sales-outreach", "sales-followup"],
      audience: "customers",
      start: "process",
    });
    expect(proposeTeam({ sector: "seo" }).members).toEqual([
      "seo-research",
      "seo-editor",
      "seo-technical",
    ]);
    expect(proposeTeam().sector).toBe("operations");
    expect(TEAM_SECTORS).toHaveLength(6);
  });

  it("keeps instructions bounded and names the requested work", () => {
    const instructions = memberInstructions({
      line: "Finds accounts",
      description: `  ${"lead ".repeat(2000)}  `,
      audience: "Just me",
      start: "Draft work for me to review",
    });
    expect(instructions.length).toBeLessThanOrEqual(BOT_INSTRUCTIONS_MAX_LENGTH);
    expect(instructions).toContain("The user described the work as:");
    expect(instructions).toContain(
      "Do not send messages, publish, spend, delete, or expand permissions",
    );
    expect(instructions).toContain("Reply in the user's language.");
    const draft = draftOnboardingTeam("sales leads", { sector: "sales", audience: "me", start: "drafts" }, copy);
    expect(draft[0]).toMatchObject({ id: "sales-research", lead: true, name: "sales-research" });
    expect(draft[1]?.lead).toBe(false);
    expect(draft[0]?.instructions).toContain("This is for: Just me.");
  });
});

describe("team copy catalogs", () => {
  const source = readFileSync(fileURLToPath(new URL("./team-copy.ts", import.meta.url)), "utf8");
  const messages = [...source.matchAll(/t`([^`$]*)`/g)].map((match) => match[1] ?? "");

  function catalog(locale: string) {
    const text = readFileSync(
      fileURLToPath(new URL(`../../locales/${locale}/messages.po`, import.meta.url)),
      "utf8",
    );
    return new Map(
      [...text.matchAll(/^msgid ("(?:\\.|[^"\\])*")\nmsgstr ("(?:\\.|[^"\\])*")/gm)].map(
        (match) => [JSON.parse(match[1]!), JSON.parse(match[2]!)],
      ),
    );
  }

  it("has English and Spanish copy for every team-builder string", () => {
    const english = catalog("en");
    const spanish = catalog("es");
    const sameInSpanish = new Set(["SEO", "Marketing"]);
    expect(messages.length).toBeGreaterThan(20);
    for (const message of messages) {
      expect(english.get(message), message).toBe(message);
      const translated = spanish.get(message);
      expect(translated, message).toBeTruthy();
      if (!sameInSpanish.has(message)) expect(translated, message).not.toBe(message);
    }
    expect(spanish.get("Back to your team")).toBe("Volver a tu equipo");
    expect(draftOnboardingTeam("sales", { sector: "sales" }, copy)[0]?.id).toBe("sales-research");
    expect(FIRST_MICO_SPAWN_KEY).toBe("onboarding:first");
  });
});
