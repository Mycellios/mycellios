import { afterEach, expect, it } from "vitest";
import { accountNotificationAllowed, forgetNotificationSettings, rememberNotificationSettings } from "./account-notifications";
afterEach(() => { forgetNotificationSettings("a"); forgetNotificationSettings("b"); });
it("applies account filters to live replies, failures and requests with the same policy as push", () => {
  rememberNotificationSettings("a", { level: "needs_me", previews: false, mutedUntil: null, bots: { quiet: "off", loud: "all" } });
  expect(accountNotificationAllowed("a", "normal", { type: "thread.message.created", payload: { role: "bot" } })).toBe(false);
  expect(accountNotificationAllowed("a", "loud", { type: "run.completed", payload: {} })).toBe(true);
  expect(accountNotificationAllowed("a", "quiet", { type: "thread.ask", payload: {} })).toBe(false);
  for (const type of ["run.failed", "run.waiting_input", "thread.choice", "computer.takeover.requested"] as const)
    expect(accountNotificationAllowed("a", "normal", { type, payload: {} })).toBe(true);
  expect(accountNotificationAllowed("a", "normal", { type: "thread.message.created", payload: { blocks: [{ kind: "subagent", status: "failed" }] } })).toBe(true);
});
it("never bypasses master off or pause and never reuses another account's settings", () => {
  rememberNotificationSettings("a", { level: "off", previews: true, mutedUntil: null, bots: { loud: "all" } });
  expect(accountNotificationAllowed("a", "loud", { type: "thread.ask", payload: {} })).toBe(false);
  expect(accountNotificationAllowed("b", "loud", { type: "thread.ask", payload: {} })).toBe(false);
  rememberNotificationSettings("a", { level: "all", previews: true, mutedUntil: new Date(2000).toISOString(), bots: {} });
  expect(accountNotificationAllowed("a", "loud", { type: "thread.ask", payload: {} }, 1000)).toBe(false);
  expect(accountNotificationAllowed("a", "loud", { type: "thread.ask", payload: {} }, 2000)).toBe(true);
});
