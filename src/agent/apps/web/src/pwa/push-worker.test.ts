import { existsSync } from "node:fs";
import { MICO_AVATAR_SHAPES } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { parsePushPayload, pushChatUrl, pushNotification } from "./push-worker.js";
import { notificationTarget } from "./notification-target.js";

const origin = "https://www.mycellios.com";
const scope = origin + "/agent/";
const now = Date.UTC(2026, 10, 8);
const payload = {
  version: 1, id: "event-1", accountId: "owner", botId: "jarvis", threadId: "thread",
  spaceId: "space", title: "Mycellios", body: "Your Mico has finished.",
  tag: "mycellios:thread", expiresAt: now + 1000,
};

describe("Web Push navigation", () => {
  it("opens the exact task in the correct Space within the installed PWA", () => {
    const parsed = parsePushPayload({ ...payload, taskThreadId: "task-1" }, now);
    expect(parsed).not.toBeNull();
    expect(notificationTarget(pushChatUrl(parsed!, scope), origin, "/agent"))
      .toBe(scope + "app/jarvis?noticeSpace=space&task=task-1");
  });
  it("opens a group directly and rejects malformed or expired messages", () => {
    const parsed = parsePushPayload({ ...payload, groupId: "team", taskThreadId: "task-1" }, now);
    expect(notificationTarget(pushChatUrl(parsed!, scope), origin, "/agent"))
      .toBe(scope + "app/g/team?noticeSpace=space");
    expect(parsePushPayload({ ...payload, botId: "../account" }, now)).toBeNull();
    expect(parsePushPayload(payload, now + 1001)).toBeNull();
  });
  it("shows the event and a generic mascot when previews are off, even with private metadata", () => {
    const parsed = parsePushPayload({
      ...payload, title: "Private name", body: "Private answer", kind: "help", preview: false, avatar: "fox",
    }, now)!;
    const notice = pushNotification(parsed, scope, "es-ES");
    expect(notice.title).toBe("Tu Mico espera una respuesta");
    expect(notice.options).toMatchObject({
      body: "Abre el chat para responder.",
      icon: scope + "mycellios/notification-micos/mushroom.png",
      actions: [{ action: "open-chat", title: "Abrir chat" }],
      data: { url: scope + "app/jarvis?noticeSpace=space", botId: "jarvis" },
    });
  });
  it.each(MICO_AVATAR_SHAPES)("accepts the bundled $id artwork", ({ id }) => {
    expect(parsePushPayload({ ...payload, avatar: id }, now)?.avatar).toBe(id);
    expect(existsSync(new URL(`../../public/mycellios/notification-micos/${id}.png`, import.meta.url))).toBe(true);
  });
  it("shows the Mico on opt-in previews using only bundled artwork", () => {
    const preview = { ...payload, title: "Jarvis", body: "Draft ready", kind: "completion", preview: true };
    const parsed = parsePushPayload({ ...preview, avatar: "fox" }, now)!;
    expect(pushNotification(parsed, scope, "en-US")).toMatchObject({
      title: "Jarvis", options: { body: "Draft ready", icon: scope + "mycellios/notification-micos/fox.png" },
    });
    expect(parsePushPayload({ ...preview, avatar: "https://external.test/track" }, now)).toBeNull();
  });
});
