import type { GroupMember, ThreadMessage } from "@mycellios/contracts";
import { describe, expect, it } from "vitest";
import {
  finishedGroupReplies,
  groupRepliesBySpeaker,
  groupReplyToRead,
  groupVoiceMember,
  workingRunIds,
} from "./group-voice";

const members: GroupMember[] = [
  { botId: "chief", name: "Chief", color: "#3F9F78" },
  { botId: "sales", name: "Sales", color: "#9B5CF6" },
];
const user = (id: string, text: string) =>
  ({ id, role: "user", blocks: [{ kind: "text", text }] }) as ThreadMessage;
const reply = (
  id: string,
  botId: string,
  runId: string,
  text: string,
  extra: Partial<ThreadMessage> = {},
) =>
  ({ id, role: "bot", botId, runId, blocks: [{ kind: "text", text }], ...extra }) as ThreadMessage;

describe("group voice", () => {
  it("reads each member's answer once its own turn ends, skipping step notes", () => {
    const messages = [
      reply("old", "chief", "earlier", "Antes."),
      reply("note", "sales", "r2", "Mirando la hoja.", { progress: true }),
      reply("a", "chief", "r1", "Reparto las tareas."),
      reply("b", "sales", "r2", "Cerró un 12% por encima."),
    ];
    const runs = new Set(["r1", "r2"]);
    expect(
      finishedGroupReplies(messages, runs, new Set(), new Set(["r2"])).map((m) => m.id),
    ).toEqual(["a"]);
    expect(
      finishedGroupReplies(messages, runs, new Set(["a"]), new Set()).map((m) => m.id),
    ).toEqual(["b"]);
  });

  it("joins consecutive replies of one Mico into one utterance in its voice", () => {
    expect(
      groupRepliesBySpeaker([
        reply("a", "chief", "r1", "Primero."),
        reply("b", "chief", "r1", "Segundo."),
        reply("c", "sales", "r2", "Tercero."),
      ] as Array<ThreadMessage & { botId: string }>),
    ).toEqual([
      { botId: "chief", text: "Primero.\n\nSegundo." },
      { botId: "sales", text: "Tercero." },
    ]);
  });

  it("shows the member still working, else the lead", () => {
    expect(groupVoiceMember(members, "sales")?.name).toBe("Sales");
    expect(groupVoiceMember(members, null)?.name).toBe("Chief");
    expect(
      groupVoiceMember(members, "chief", [{ id: "r2", botId: "sales", status: "running" }])?.name,
    ).toBe("Sales");
    expect(
      workingRunIds([
        null,
        { id: "r1", botId: "chief", status: "waiting_input" },
        { id: "r2", botId: "sales", status: "running" },
      ]),
    ).toEqual(new Set(["r2"]));
  });

  it("reads the first finished answer to the newest message, preferring the member it named", () => {
    const answered = [user("u1", "¿Cómo vamos?"), reply("a", "chief", "r1", "Bien.")];
    expect(groupReplyToRead(answered, members)?.id).toBe("a");
    expect(
      groupReplyToRead(answered, members, [{ id: "r1", botId: "chief", status: "running" }]),
    ).toBeUndefined();
    const named = [
      user("u2", "@Sales dame los números"),
      reply("a", "chief", "r1", "Se lo paso."),
      reply("b", "sales", "r2", "Un 12% más."),
    ];
    expect(groupReplyToRead(named, members)?.id).toBe("b");
    expect(groupReplyToRead([...answered, user("u3", "¿Y ahora?")], members)).toBeUndefined();
  });
});
