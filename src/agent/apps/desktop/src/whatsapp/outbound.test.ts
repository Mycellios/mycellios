import { describe, expect, it } from "vitest";
import { planOperation, sendError } from "./outbound.js";

const OWN = "34600000001:7@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
const FRIEND = "34600000002@s.whatsapp.net";

describe("planOperation", () => {
  it("sends plain text with the preassigned message id", () => {
    expect(
      planOperation(
        { id: "op1", linkId: "l1", chatJid: FRIEND, kind: "text", text: "Hola" },
        OWN,
        "MID1",
      ),
    ).toEqual({
      jid: FRIEND,
      content: { text: "Hola" },
      options: { messageId: "MID1" },
    });
  });

  it("quotes a group message with a minimal stub when the original is not in memory", () => {
    const plan = planOperation(
      {
        id: "op2",
        linkId: "l1",
        chatJid: GROUP,
        kind: "text",
        text: "Done",
        quotedId: "Q1",
        quotedParticipant: FRIEND,
      },
      OWN,
      "MID2",
    );
    expect(plan.options.quoted).toEqual({
      key: { remoteJid: GROUP, id: "Q1", fromMe: false, participant: FRIEND },
      message: { conversation: "" },
    });
  });

  it("quotes with the cached original and marks the owner's own chat as fromMe", () => {
    const plan = planOperation(
      {
        id: "op3",
        linkId: "l1",
        chatJid: "34600000001@s.whatsapp.net",
        kind: "text",
        text: "Ok",
        quotedId: "Q2",
      },
      OWN,
      "MID3",
      (id) => (id === "Q2" ? { conversation: "original" } : undefined),
    );
    expect(plan.options.quoted).toEqual({
      key: { remoteJid: "34600000001@s.whatsapp.net", id: "Q2", fromMe: true },
      message: { conversation: "original" },
    });
  });

  it("maps a reaction to the target key", () => {
    expect(
      planOperation(
        {
          id: "op4",
          linkId: "l1",
          chatJid: GROUP,
          kind: "reaction",
          emoji: "👀",
          targetId: "T1",
          targetFromMe: false,
          targetParticipant: FRIEND,
        },
        OWN,
        "MID4",
      ),
    ).toEqual({
      jid: GROUP,
      content: {
        react: {
          text: "👀",
          key: { remoteJid: GROUP, id: "T1", fromMe: false, participant: FRIEND },
        },
      },
      options: { messageId: "MID4" },
    });
  });

  it("reports short errors without message content", () => {
    expect(sendError(new Error("Connection Closed"))).toBe("WhatsApp is not connected");
    expect(sendError(new Error("secret text"))).toBe("WhatsApp send failed");
  });
});
