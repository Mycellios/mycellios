// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { eventAgentContext, eventAgentSpace, saveEventAgentContext, withEventAgentHeaders } from "./event-demo-agent";
afterEach(() => { sessionStorage.clear(); localStorage.clear(); });
it("keeps the guest selector and workspace inside this tab without overwriting a personal workspace", () => {
  localStorage.setItem("rakazo:space-id", "personal-space");
  expect(withEventAgentHeaders().has("x-mycellios-demo-event")).toBe(false);
  saveEventAgentContext({ id: "test-only-event", spaceId: "guest-space", botId: "mico", endsAt: Date.now() + 1000 });
  expect(withEventAgentHeaders().get("x-mycellios-demo-event")).toBe("test-only-event");
  eventAgentSpace("guest-second-space");
  expect(eventAgentContext()?.spaceId).toBe("guest-second-space");
  expect(localStorage.getItem("rakazo:space-id")).toBe("personal-space");
  sessionStorage.clear();
  expect(eventAgentContext()).toBeNull();
});
