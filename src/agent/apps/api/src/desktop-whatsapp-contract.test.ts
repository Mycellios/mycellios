import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bareWhatsAppJid,
  normalizeWhatsAppPhone,
  parseDesktopWhatsAppInbound,
  parseDesktopWhatsAppLinkConfig,
  parseDesktopWhatsAppOperation,
  parseDesktopWhatsAppPull,
  parseDesktopWhatsAppRegister,
  parseDesktopWhatsAppResult,
  parseDesktopWhatsAppSync,
  WHATSAPP_MAX_ATTACHMENT_BYTES,
  WHATSAPP_MAX_BATCH,
} from "../../../../contracts/desktop-whatsapp.js";

const device = randomUUID();
const message = (overrides: Record<string, unknown> = {}) => ({
  id: "3EB0ABCDEF",
  chatJid: "34611222333@s.whatsapp.net",
  senderJid: "34611222333@s.whatsapp.net",
  senderName: "Ana\u0000\n",
  kind: "contact",
  text: "hola",
  timestamp: 1_800_000_000,
  ...overrides,
});

describe("desktop whatsapp protocol", () => {
  it("normalizes phones and bare ids", () => {
    expect(normalizeWhatsAppPhone("+34 (600) 111-222")).toBe("34600111222");
    expect(normalizeWhatsAppPhone("0034600111222")).toBe("34600111222");
    expect(normalizeWhatsAppPhone("12")).toBeNull();
    expect(bareWhatsAppJid("34600111222:12@s.whatsapp.net")).toBe("34600111222@s.whatsapp.net");
  });

  it("parses registration and keeps only bare account ids", () => {
    expect(
      parseDesktopWhatsAppRegister({
        desktopDeviceId: device,
        botId: "bot-1",
        mode: "dedicated",
        accountJid: "34600111222:3@s.whatsapp.net",
        accountLid: "99887766554:3@lid",
        phone: "+34 600 111 222",
        pushName: " Dani ",
      }),
    ).toEqual({
      desktopDeviceId: device,
      botId: "bot-1",
      mode: "dedicated",
      accountJid: "34600111222@s.whatsapp.net",
      accountLid: "99887766554@lid",
      phone: "34600111222",
      pushName: "Dani",
    });
    for (const bad of [
      { accountJid: "120363@g.us" },
      { mode: "business" },
      { desktopDeviceId: "device" },
      { extra: true },
    ])
      expect(() =>
        parseDesktopWhatsAppRegister({
          desktopDeviceId: device,
          botId: "bot-1",
          mode: "personal",
          accountJid: "34600111222@s.whatsapp.net",
          phone: "34600111222",
          ...bad,
        }),
      ).toThrow();
  });

  it("bounds sync, inbound, pull and result payloads", () => {
    expect(
      parseDesktopWhatsAppSync({
        desktopDeviceId: device,
        links: [{ linkId: "l", status: "connected", groups: [{ jid: "1203630@g.us", name: "" }] }],
      }).links[0]!.groups,
    ).toEqual([{ jid: "1203630@g.us", name: "Group" }]);
    expect(() =>
      parseDesktopWhatsAppSync({
        desktopDeviceId: device,
        links: [{ linkId: "l", status: "online" }],
      }),
    ).toThrow();
    const parsed = parseDesktopWhatsAppInbound({
      desktopDeviceId: device,
      linkId: "l",
      messages: [message()],
    });
    expect(parsed.messages[0]!.senderName).toBe("Ana");
    expect(() =>
      parseDesktopWhatsAppInbound({
        desktopDeviceId: device,
        linkId: "l",
        messages: [message({ kind: "group" })],
      }),
    ).toThrow();
    expect(() =>
      parseDesktopWhatsAppInbound({
        desktopDeviceId: device,
        linkId: "l",
        messages: Array.from({ length: WHATSAPP_MAX_BATCH + 1 }, () => message()),
      }),
    ).toThrow();
    const attachment = (size: number) => ({
      name: "a",
      mimeType: "image/png",
      dataBase64: "A".repeat(size),
    });
    expect(() =>
      parseDesktopWhatsAppInbound({
        desktopDeviceId: device,
        linkId: "l",
        messages: [
          message({ attachment: attachment(Math.ceil(WHATSAPP_MAX_ATTACHMENT_BYTES / 3) * 4 + 4) }),
        ],
      }),
    ).toThrow();
    expect(() =>
      parseDesktopWhatsAppInbound({
        desktopDeviceId: device,
        linkId: "l",
        messages: [
          message({ attachment: attachment(4) }),
          message({ id: "B", attachment: attachment(4) }),
        ],
      }),
    ).toThrow();
    expect(parseDesktopWhatsAppPull({ desktopDeviceId: device, wait: true })).toEqual({
      desktopDeviceId: device,
      wait: true,
    });
    expect(() => parseDesktopWhatsAppPull({ desktopDeviceId: device, wait: "yes" })).toThrow();
    expect(() =>
      parseDesktopWhatsAppResult({ desktopDeviceId: device, id: "x", ok: true, handle: "a b" }),
    ).toThrow();
  });

  it("parses server responses as strictly as requests", () => {
    expect(
      parseDesktopWhatsAppLinkConfig({
        linkId: "l",
        botId: "b",
        mode: "personal",
        accountJid: "34600111222@s.whatsapp.net",
        allowed: [{ jid: "1203630@g.us", kind: "group" }],
        pending: [],
      }).allowed,
    ).toEqual([{ jid: "1203630@g.us", kind: "group" }]);
    expect(
      parseDesktopWhatsAppOperation({
        id: "o",
        linkId: "l",
        chatJid: "1203630@g.us",
        kind: "reaction",
        emoji: "✅",
        targetId: "3EB0",
        targetFromMe: false,
        targetParticipant: "34611222333@s.whatsapp.net",
      }),
    ).toMatchObject({ kind: "reaction", emoji: "✅" });
    expect(() =>
      parseDesktopWhatsAppOperation({
        id: "o",
        linkId: "l",
        chatJid: "1203630@g.us",
        kind: "text",
        text: "",
      }),
    ).toThrow();
  });
});
