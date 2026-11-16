import type { CreateBotInput } from "@rakazo/contracts";
import { defaultComputerMode, desktopBridge } from "../../lib/desktop";
import {
  memberInstructions,
  memberSpawnKey,
  proposeTeam,
  type TeamAnswers,
  type TeamMemberId,
} from "./team-catalog";

export type OnboardingTeamMember = {
  id: TeamMemberId;
  name: string;
  title: string;
  description: string;
  instructions: string;
  lead: boolean;
};

export type OnboardingTeamCreateInput = Pick<
  CreateBotInput,
  | "name"
  | "title"
  | "description"
  | "instructions"
  | "notifyOnFinish"
  | "spawnKey"
  | "agentEngine"
  | "computerMode"
>;

type ExistingBot = { id: string; spawnKey: string | null };

export function draftOnboardingTeam(
  description: string,
  answers: TeamAnswers,
  copy: {
    member: (id: TeamMemberId) => { name: string; line: string };
    audience: string;
    start: string;
  },
): OnboardingTeamMember[] {
  const proposed = proposeTeam(answers);
  return proposed.members.map((id, index) => {
    const member = copy.member(id);
    return {
      id,
      name: member.name,
      title: member.line,
      description: member.line,
      instructions: memberInstructions({
        line: member.line,
        description,
        audience: copy.audience,
        start: copy.start,
      }),
      lead: index === 0,
    };
  });
}

export async function createOnboardingTeam(
  members: readonly OnboardingTeamMember[],
  client: {
    list: () => Promise<ExistingBot[]>;
    create: (input: OnboardingTeamCreateInput) => Promise<{ id: string }>;
    lock?: <T>(run: () => Promise<T>) => Promise<T>;
    signal?: AbortSignal;
    agentEngine?: CreateBotInput["agentEngine"];
  },
): Promise<{ id: string }> {
  if (members.length === 0) throw new Error("Choose at least one Mico");
  const computerMode = defaultComputerMode(desktopBridge(), Boolean(client.agentEngine));
  const run = async () => {
    client.signal?.throwIfAborted();
    const existing = [...(await client.list())];
    let firstId = "";
    for (const member of members) {
      client.signal?.throwIfAborted();
      const spawnKey = memberSpawnKey(member.id, member.lead);
      const found = existing.find((bot) => bot.spawnKey === spawnKey);
      if (found) {
        if (!firstId) firstId = found.id;
        continue;
      }
      const created = await client.create({
        name: member.name,
        title: member.title,
        description: member.description,
        instructions: member.instructions,
        notifyOnFinish: true,
        computerMode,
        spawnKey,
        ...(client.agentEngine ? { agentEngine: client.agentEngine } : {}),
      });
      existing.push({ id: created.id, spawnKey });
      if (!firstId) firstId = created.id;
    }
    if (!firstId) throw new Error("Choose at least one Mico");
    client.signal?.throwIfAborted();
    return { id: firstId };
  };
  return client.lock ? client.lock(run) : run();
}
