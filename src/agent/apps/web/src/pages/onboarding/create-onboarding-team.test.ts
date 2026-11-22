import { FIRST_MICO_SPAWN_KEY, type MycelliosDesktop } from "@mycellios/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { desktopBridge } from "../../lib/desktop";
import { createOnboardingTeam, type OnboardingTeamMember } from "./create-onboarding-team";

vi.mock("../../lib/desktop", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/desktop")>(),
  desktopBridge: vi.fn(),
}));

beforeEach(() => vi.mocked(desktopBridge).mockReturnValue(undefined));

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

it("resumes interrupted creation without duplicate profiles or automatic inference", async () => {
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
    computerMode: "isolated",
  });
  expect(create.mock.calls[2]?.[0]).toMatchObject({
    spawnKey: "onboarding:team:sales-outreach",
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

it("stops starting new profile writes after leaving setup", async () => {
  const controller = new AbortController();
  const create = vi.fn(async () => {
    controller.abort();
    return { id: "already-created" };
  });
  await expect(createOnboardingTeam(members, { list: async () => [], create, signal: controller.signal }))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(create).toHaveBeenCalledTimes(1);
});

it.each([false, true])("keeps ordinary model/API profiles isolated with Desktop available=%s", async desktop => {
  vi.mocked(desktopBridge).mockReturnValue(desktop ? {} as MycelliosDesktop : undefined);
  const create = vi.fn(async (input: { spawnKey?: string }) => ({ id: input.spawnKey! }));
  await createOnboardingTeam(members, { list: async () => [], create });
  expect(create).toHaveBeenCalledTimes(members.length);
  for (const [input] of create.mock.calls) {
    expect(input).toMatchObject({ computerMode: "isolated" });
    expect(input).not.toHaveProperty("agentEngine");
  }
});

it.each([
  ["codex", false, "team"], ["claude", false, "team"],
  ["codex", true, "dedicated"], ["claude", true, "dedicated"],
] as const)("keeps every proposed role for installed %s with Desktop=%s on %s", async (agentEngine, desktop, computerMode) => {
  vi.mocked(desktopBridge).mockReturnValue(desktop ? {} as MycelliosDesktop : undefined);
  const create = vi.fn(async (input: { spawnKey?: string }) => ({ id: input.spawnKey! }));
  await createOnboardingTeam(members, { list: async () => [], create, agentEngine });
  expect(create).toHaveBeenCalledTimes(members.length);
  for (const [input] of create.mock.calls) expect(input).toMatchObject({ agentEngine, computerMode });
});

it("never reassigns an existing profile when a retry chooses an installed account", async () => {
  vi.mocked(desktopBridge).mockReturnValue({} as MycelliosDesktop);
  const create = vi.fn(async (input: { spawnKey?: string }) => ({ id: input.spawnKey! }));
  const existing = { id: "bot-lead", spawnKey: FIRST_MICO_SPAWN_KEY, computerMode: "isolated" };
  await createOnboardingTeam(members, { list: async () => [existing], create, agentEngine: "codex" });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[0]).toMatchObject({ spawnKey: "onboarding:team:sales-outreach", computerMode: "dedicated", agentEngine: "codex" });
  expect(existing.computerMode).toBe("isolated");
});
