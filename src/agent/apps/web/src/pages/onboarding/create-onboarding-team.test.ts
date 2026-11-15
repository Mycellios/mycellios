import { FIRST_MICO_SPAWN_KEY } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
import { createOnboardingTeam, type OnboardingTeamMember } from "./create-onboarding-team";

const members: OnboardingTeamMember[] = [
  {
    id: "sales-research",
    name: "Lead Researcher",
    title: "Finds accounts",
    description: "Finds accounts",
    instructions: "Find accounts.",
    lead: true,
  },
  {
    id: "sales-outreach",
    name: "Outreach Writer",
    title: "Drafts messages",
    description: "Drafts messages",
    instructions: "Draft messages.",
    lead: false,
  },
];

it("creates the lead once and skips intro runs for the rest of the team", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce({ id: "bot-lead" })
    .mockRejectedValueOnce(new Error("interrupted"))
    .mockResolvedValueOnce({ id: "bot-writer" });
  const list = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "bot-lead", spawnKey: FIRST_MICO_SPAWN_KEY }]);
  let locks = 0;
  const lock = async <T>(run: () => Promise<T>) => {
    locks += 1;
    return run();
  };
  await expect(createOnboardingTeam(members, { list, create, lock })).rejects.toThrow(
    "interrupted",
  );
  const created = await createOnboardingTeam(members, { list, create, lock });
  expect(created).toEqual({ id: "bot-lead" });
  expect(create).toHaveBeenCalledTimes(3);
  expect(create.mock.calls[0]?.[0]).toMatchObject({
    name: "Lead Researcher",
    spawnKey: FIRST_MICO_SPAWN_KEY,
    skipIntro: false,
    computerMode: "team",
  });
  expect(create.mock.calls[2]?.[0]).toMatchObject({
    spawnKey: "onboarding:team:sales-outreach",
    skipIntro: true,
  });
  expect(locks).toBe(2);
});

it("reuses an existing lead instead of creating a second first Mico", async () => {
  const create = vi.fn().mockResolvedValue({ id: "bot-writer" });
  const list = vi.fn().mockResolvedValue([{ id: "bot-lead", spawnKey: FIRST_MICO_SPAWN_KEY }]);
  await expect(createOnboardingTeam(members, { list, create })).resolves.toEqual({
    id: "bot-lead",
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[0].spawnKey).toBe("onboarding:team:sales-outreach");
});
