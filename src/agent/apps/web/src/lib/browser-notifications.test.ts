import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserNotificationApi,
  type BrowserNotificationContext,
  browserNotificationMessage,
  deliverBrowserNotification,
  requestBrowserNotificationPermission,
  shouldNotifyBrowser,
  showSystemNotification,
} from "./browser-notifications.js";
import { i18n } from "./i18n.js";

function event(
  overrides: Partial<{
    type:
      | "thread.message.created"
      | "run.completed"
      | "run.failed"
      | "run.cancelled"
      | "run.waiting_input"
      | "thread.choice"
      | "thread.subagent"
      | "run.started";
    threadId: string;
    id: string;
    runId: string;
    seq: number;
    payload: Record<string, unknown>;
  }> = {},
) {
  return {
    type: "thread.message.created" as const,
    id: "event-1",
    threadId: "thread-1",
    runId: "run-1",
    seq: 8,
    payload: { role: "bot", blocks: [{ kind: "text", text: "The pool is balanced." }] },
    ...overrides,
  };
}

function context(overrides: Partial<BrowserNotificationContext> = {}): BrowserNotificationContext {
  return {
    subscribedThreadId: "thread-1",
    initialCursor: 7,
    streamReady: true,
    pageVisible: false,
    windowFocused: false,
    permission: "granted",
    notifiedEventIds: new Set(),
    ...overrides,
  };
}

describe("browser notifications", () => {
  it("delivers through an active service worker on mobile with a namespaced chat link", async () => {
    const show = vi.fn(async () => undefined);
    const constructor = vi.fn();
    vi.stubGlobal("Notification", constructor);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({
      active: {}, showNotification: show,
    }) } });
    try {
      await showSystemNotification("Chief", "Reply ready", "thread-1", "/app/g/group", false);
      expect(show).toHaveBeenCalledExactlyOnceWith("Chief", expect.objectContaining({
        tag: "thread-1", silent: true, data: { url: expect.stringMatching(/\/app\/g\/group$/) },
      }));
      expect(constructor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  beforeEach(() => {
    i18n.load("en", {
      "{name} failed": "{name} failed",
      "{name} finished": "Chief finished",
      "{name} stopped": "Chief stopped",
      "Failed.": "Failed.",
      "Stopped.": "Stopped.",
      "Finished.": "Finished.",
    });
    i18n.activate("en");
  });

  it("only accepts a new bot message for the hidden or unfocused subscribed thread", () => {
    expect(shouldNotifyBrowser(event(), context())).toBe(true);
    expect(shouldNotifyBrowser(event({ type: "run.started" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ type: "run.failed" }), context())).toBe(true);
    expect(shouldNotifyBrowser(event({ type: "run.cancelled" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ payload: { role: "user", blocks: [] } }), context())).toBe(
      false,
    );
    expect(shouldNotifyBrowser(event({ type: "run.completed" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ threadId: "other-thread" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ seq: 7 }), context())).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ pageVisible: true, windowFocused: false }))).toBe(
      true,
    );
    expect(shouldNotifyBrowser(event(), context({ pageVisible: false, windowFocused: true }))).toBe(
      true,
    );
    expect(shouldNotifyBrowser(event(), context({ streamReady: false }))).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ pageVisible: true, windowFocused: true }))).toBe(
      false,
    );
    expect(shouldNotifyBrowser(event(), context({ permission: "default" }))).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ notifiedEventIds: new Set(["event-1"]) }))).toBe(
      false,
    );
  });

  it("puts the bot message in the native notification", () => {
    expect(browserNotificationMessage(event(), "Chief")).toEqual({
      title: "Chief",
      body: "The pool is balanced.",
    });
    expect(
      browserNotificationMessage(
        event({
          payload: {
            role: "bot",
            blocks: [{ kind: "text", text: "| Pool | Total |\n| --- | --- |\n| main | **42** |" }],
          },
        }),
        "Chief",
      ),
    ).toEqual({ title: "Chief", body: "Pool, Total main, 42" });
    expect(browserNotificationMessage(event({ type: "run.failed" }), "Chief")).toEqual({
      title: "Chief failed",
      body: "Failed.",
    });
    expect(browserNotificationMessage(event({ type: "run.cancelled" }), "Chief")).toEqual({
      title: "Chief stopped",
      body: "Stopped.",
    });
  });

  it("alerts once for a choice and its waiting-state event without exposing the prompt", () => {
    const choice = event({ type: "thread.choice", payload: { text: "Private approval details" } });
    const waiting = event({ id: "event-2", type: "run.waiting_input" });
    const notifiedEventIds = new Set<string>();
    const show = vi.fn();
    expect(shouldNotifyBrowser(choice, context())).toBe(true);
    expect(deliverBrowserNotification(choice, "Chief", {
      ...context(), enabled: true, notifiedEventIds, show,
    })).toBe("delivered");
    expect(show.mock.calls[0]?.[1]).not.toContain("Private approval details");
    expect(shouldNotifyBrowser(waiting, context({ notifiedEventIds }))).toBe(false);
  });

  it("dedupes a replay but delivers another message from the same run", () => {
    const notifiedEventIds = new Set<string>();
    const show = vi.fn().mockImplementationOnce(() => {
      throw new Error("notification construction failed");
    });
    const delivery = (permission: "default" | "granted", nextEvent = event()) =>
      deliverBrowserNotification(nextEvent, "Chief", {
        enabled: true,
        pageVisible: false,
        windowFocused: false,
        permission,
        notifiedEventIds,
        show,
      });

    expect(delivery("default")).toBe("pending");
    expect(delivery("granted")).toBe("pending");
    expect(notifiedEventIds).toEqual(new Set());
    expect(delivery("granted")).toBe("delivered");
    expect(notifiedEventIds).toEqual(new Set(["event-1"]));
    expect(show).toHaveBeenLastCalledWith("Chief", "The pool is balanced.", "thread-1");
    expect(delivery("granted")).toBe("discarded");
    expect(delivery("granted", event({ id: "event-2" }))).toBe("delivered");
    expect(show).toHaveBeenCalledTimes(3);
  });

  it("alerts on a failed helper, without exposing its error or replaying its saved card", () => {
    const failed = event({ type: "thread.subagent", payload: {
      agentId: "helper-1", name: "Reviewer", status: "failed", task: "Inspect code",
      result: "private provider diagnostic",
    } });
    expect(shouldNotifyBrowser(failed, context())).toBe(true);
    expect(browserNotificationMessage(failed, "Chief")).toEqual({ title: "Chief · Reviewer failed", body: "Failed." });
    const notifiedEventIds = new Set<string>();
    const show = vi.fn();
    const delivery = { enabled: true, pageVisible: false, windowFocused: false,
      permission: "granted" as const, notifiedEventIds, show };
    expect(deliverBrowserNotification(failed, "Chief", delivery)).toBe("delivered");
    const saved = event({ id: "saved-failure", payload: { role: "bot", blocks: [
      { kind: "subagent", ...failed.payload },
    ] } });
    expect(shouldNotifyBrowser(saved, context({ notifiedEventIds }))).toBe(false);
    expect(deliverBrowserNotification(saved, "Chief", delivery)).toBe("discarded");
    expect(show).toHaveBeenCalledTimes(1);
    expect(shouldNotifyBrowser(event({ ...failed, id: "next-run", runId: "run-2" }), context({ notifiedEventIds }))).toBe(true);
    expect(shouldNotifyBrowser(event({ ...failed, id: "other", payload: { ...failed.payload, status: "running" } }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ ...failed, id: "other", payload: { ...failed.payload, status: "completed" } }), context())).toBe(false);
  });

  it("allows a later send gesture to retry a dismissed permission prompt", async () => {
    let resolvePermission: ((permission: "default") => void) | undefined;
    const requestPermission = vi.fn(
      () =>
        new Promise<"default">((resolve) => {
          resolvePermission = resolve;
        }),
    );
    const api: BrowserNotificationApi = { permission: "default", requestPermission };

    requestBrowserNotificationPermission(api);
    requestBrowserNotificationPermission(api);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    resolvePermission?.("default");
    await Promise.resolve();
    requestBrowserNotificationPermission(api);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });
});

it("uses a readable fallback for opaque notification names", () => {
  expect(browserNotificationMessage(event(), "__TestTok1__").title).toBe("Bot");
});

it("hides both private Mico names and response content when previews are disabled",()=>{
  i18n.load("en", {"New activity in Mycellios.":"New activity in Mycellios."}); i18n.activate("en");
  const show=vi.fn();expect(deliverBrowserNotification(event(),"Private Mico",{enabled:true,preview:false,pageVisible:false,windowFocused:false,permission:"granted",notifiedEventIds:new Set(),show})).toBe("delivered");
  expect(show).toHaveBeenCalledWith("Mycellios","New activity in Mycellios.","thread-1");
});
