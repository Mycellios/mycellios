import { describe, expect, it } from "vitest";
import { parsePushPayload, pushChatUrl } from "./push-worker.js";
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
});
