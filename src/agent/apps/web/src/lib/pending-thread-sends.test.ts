import type { ProductEvent, ThreadSnapshot } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  type PendingThreadSend,
  pendingSendMatchesEvent,
  visiblePendingSends,
} from "./pending-thread-sends";

const send: PendingThreadSend = {
  scope: "account/space",
  threadId: "thread",
  nonce: "nonce",
  text: "Same text",
  attachments: ["notes.txt"],
};
const snapshot = { threadId: "thread", messages: [] } as unknown as ThreadSnapshot;
const event = {
  threadId: "thread",
  type: "thread.message.created",
  payload: { role: "user", clientNonce: "nonce" },
} as unknown as ProductEvent;
describe("pending message identity", () => {
  it("shows an unacknowledged message only in its exact account/Space/thread", () => {
    expect(visiblePendingSends([send], send.scope, snapshot)).toEqual([send]);
    expect(visiblePendingSends([send], "another-account/space", snapshot)).toEqual([]);
    expect(visiblePendingSends([send], "account/another-space", snapshot)).toEqual([]);
    expect(visiblePendingSends([send], send.scope, { ...snapshot, threadId: "other" })).toEqual([]);
    expect(visiblePendingSends([send], send.scope, null)).toEqual([]);
  });
  it("reconciles SSE-before-HTTP by nonce, never by matching text", () => {
    expect(pendingSendMatchesEvent(send, event)).toBe(true);
    expect(pendingSendMatchesEvent(send, { ...event, threadId: "other" })).toBe(false);
    expect(
      pendingSendMatchesEvent(send, {
        ...event,
        payload: { role: "user", text: send.text, clientNonce: "other" },
      }),
    ).toBe(false);
    expect(
      pendingSendMatchesEvent(send, { ...event, payload: { role: "bot", clientNonce: "nonce" } }),
    ).toBe(false);
  });
  it("reconciles an HTTP receipt with its exact durable user sequence", () => {
    const accepted = { ...send, seq: 7 };
    expect(visiblePendingSends([accepted], send.scope, snapshot)).toEqual([accepted]);
    expect(
      visiblePendingSends([accepted], send.scope, {
        ...snapshot,
        messages: [{ seq: 7, role: "bot" }] as never,
      }),
    ).toEqual([accepted]);
    expect(
      visiblePendingSends([accepted], send.scope, {
        ...snapshot,
        messages: [{ seq: 7, role: "user" }] as never,
      }),
    ).toEqual([]);
  });
});
