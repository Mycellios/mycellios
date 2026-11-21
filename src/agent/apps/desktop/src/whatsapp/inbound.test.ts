import { describe, expect, it } from "vitest";
import type { InboundContext } from "./inbound.js";
import { attachmentTooLarge, classifyInbound, messageContent, tooLargeNote } from "./inbound.js";
import type { WAMessage } from "./types.js";

const NOW = 1_800_000_000;
const OWN = "34600000001@s.whatsapp.net";
const OWN_LID = "111111111111@lid";
const FRIEND = "34600000002@s.whatsapp.net";
const FRIEND_LID = "222222222222@lid";
const STRANGER = "34600000003@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";

function context(
  overrides: Partial<InboundContext> = {},
  config: Partial<InboundContext["config"]> = {},
): InboundContext {
  return {
    self: { jid: OWN, lid: OWN_LID },
    config: {
      mode: "personal",
      allowed: [
        { jid: FRIEND, kind: "contact" },
        { jid: GROUP, kind: "group" },
      ],
      pending: [],
      ...config,
    },
    sentIds: new Set(["BOTSENT1"]),
    now: NOW,
    ...overrides,
  };
}

function message(
  key: WAMessage["key"],
  body: WAMessage["message"],
  extra: Partial<WAMessage> = {},
): WAMessage {
  return { key, message: body, messageTimestamp: NOW - 10, pushName: "Ana", ...extra };
}

describe("classifyInbound", () => {
  it("accepts the owner's own chat only for the owner's messages", () => {
    const own = message(
      { remoteJid: "34600000001:3@s.whatsapp.net", fromMe: true, id: "A1" },
      { conversation: "hola" },
    );
    expect(classifyInbound(own, context())).toMatchObject({
      kind: "self",
      chatJid: OWN,
      senderJid: OWN,
      text: "hola",
    });
    const viaLid = message(
      { remoteJid: OWN_LID, fromMe: true, id: "A2" },
      { conversation: "hola" },
    );
    expect(classifyInbound(viaLid, context())?.kind).toBe("self");
  });

  it("drops echoes of messages the connector sent", () => {
    const echo = message({ remoteJid: OWN, fromMe: true, id: "BOTSENT1" }, { conversation: "👋" });
    expect(classifyInbound(echo, context())).toBeNull();
  });

  it("never uploads the owner's own messages to other people", () => {
    expect(
      classifyInbound(
        message({ remoteJid: FRIEND, fromMe: true, id: "A3" }, { conversation: "hi" }),
        context(),
      ),
    ).toBeNull();
  });

  it("uploads allowed contacts and drops unknown senders on a personal number", () => {
    expect(
      classifyInbound(
        message({ remoteJid: FRIEND, fromMe: false, id: "B1" }, { conversation: "hi" }),
        context(),
      ),
    ).toMatchObject({ kind: "contact", chatJid: FRIEND, senderJid: FRIEND, senderName: "Ana" });
    expect(
      classifyInbound(
        message({ remoteJid: STRANGER, fromMe: false, id: "B2" }, { conversation: "hi" }),
        context(),
      ),
    ).toBeNull();
  });

  it("uploads first contact on a dedicated number unless the sender already has a code", () => {
    const stranger = message(
      { remoteJid: STRANGER, fromMe: false, id: "B3" },
      { conversation: "hi" },
    );
    expect(classifyInbound(stranger, context({}, { mode: "dedicated" }))?.kind).toBe("contact");
    expect(
      classifyInbound(stranger, context({}, { mode: "dedicated", pending: [STRANGER] })),
    ).toBeNull();
  });

  it("matches a sender addressed by LID through the alternate jid or the local mapping", () => {
    const withAlt = message(
      { remoteJid: FRIEND_LID, remoteJidAlt: FRIEND, fromMe: false, id: "C1" },
      { conversation: "hi" },
    );
    expect(classifyInbound(withAlt, context())).toMatchObject({
      chatJid: FRIEND,
      senderJid: FRIEND,
    });
    const bare = message(
      { remoteJid: FRIEND_LID, fromMe: false, id: "C2" },
      { conversation: "hi" },
    );
    expect(classifyInbound(bare, context())).toBeNull();
    expect(
      classifyInbound(
        bare,
        context({ pnForLid: (lid) => (lid === FRIEND_LID ? FRIEND : undefined) }),
      ),
    ).toMatchObject({ chatJid: FRIEND });
    // An allowlist entry stored as a LID also matches.
    expect(
      classifyInbound(bare, context({}, { allowed: [{ jid: FRIEND_LID, kind: "contact" }] }))
        ?.chatJid,
    ).toBe(FRIEND_LID);
  });

  it("answers allowed groups only when mentioned or when a bot message is quoted", () => {
    const plain = message(
      {
        remoteJid: GROUP,
        fromMe: false,
        id: "D1",
        participant: FRIEND_LID,
        participantAlt: FRIEND,
      },
      { conversation: "hello all" },
    );
    expect(classifyInbound(plain, context())).toBeNull();
    const mention = message(
      {
        remoteJid: GROUP,
        fromMe: false,
        id: "D2",
        participant: FRIEND_LID,
        participantAlt: FRIEND,
      },
      { extendedTextMessage: { text: "@bot hi", contextInfo: { mentionedJid: [OWN_LID] } } },
    );
    expect(classifyInbound(mention, context())).toMatchObject({
      kind: "group",
      chatJid: GROUP,
      senderJid: FRIEND,
      participant: FRIEND_LID,
    });
    const reply = message(
      { remoteJid: GROUP, fromMe: false, id: "D3", participant: FRIEND },
      { extendedTextMessage: { text: "and?", contextInfo: { stanzaId: "BOTSENT1" } } },
    );
    expect(classifyInbound(reply, context())?.kind).toBe("group");
    const otherReply = message(
      { remoteJid: GROUP, fromMe: false, id: "D4", participant: FRIEND },
      { extendedTextMessage: { text: "and?", contextInfo: { stanzaId: "SOMEONE" } } },
    );
    expect(classifyInbound(otherReply, context())).toBeNull();
    expect(classifyInbound(mention, context({}, { allowed: [] }))).toBeNull();
    expect(
      classifyInbound({ ...mention, key: { ...mention.key, fromMe: true } }, context()),
    ).toBeNull();
  });

  it("drops old, status, newsletter, reaction and protocol messages", () => {
    const old = message(
      { remoteJid: FRIEND, fromMe: false, id: "E1" },
      { conversation: "hi" },
      { messageTimestamp: NOW - 25 * 3600 },
    );
    expect(classifyInbound(old, context())).toBeNull();
    expect(
      classifyInbound(
        message(
          { remoteJid: "status@broadcast", fromMe: false, id: "E2", participant: FRIEND },
          { conversation: "x" },
        ),
        context(),
      ),
    ).toBeNull();
    expect(
      classifyInbound(
        message(
          { remoteJid: "1203630000@newsletter", fromMe: false, id: "E3" },
          { conversation: "x" },
        ),
        context(),
      ),
    ).toBeNull();
    expect(
      classifyInbound(
        message(
          { remoteJid: FRIEND, fromMe: false, id: "E4" },
          { reactionMessage: { text: "👍" } },
        ),
        context(),
      ),
    ).toBeNull();
    expect(
      classifyInbound(
        message({ remoteJid: FRIEND, fromMe: false, id: "E5" }, { protocolMessage: { type: 0 } }),
        context(),
      ),
    ).toBeNull();
  });

  it("reads captions, unwraps ephemeral messages and describes attachments", () => {
    const image = message(
      { remoteJid: FRIEND, fromMe: false, id: "F1" },
      {
        ephemeralMessage: {
          message: { imageMessage: { caption: "look", mimetype: "image/png", fileLength: 2048 } },
        },
      },
    );
    expect(classifyInbound(image, context())).toMatchObject({
      text: "look",
      media: { kind: "image", name: "image.png", size: 2048 },
    });
    expect(
      messageContent({ audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" } })?.media,
    ).toMatchObject({ kind: "audio", name: "voice-note.ogg", mimeType: "audio/ogg" });
    const big = classifyInbound(
      message(
        { remoteJid: FRIEND, fromMe: false, id: "F2" },
        {
          documentMessage: {
            fileName: "big.pdf",
            mimetype: "application/pdf",
            fileLength: 9 * 1024 * 1024,
          },
        },
      ),
      context(),
    )!;
    expect(attachmentTooLarge(big)).toBe(true);
    expect(tooLargeNote(big)).toBe("[file: big.pdf (too large)]");
  });
});
