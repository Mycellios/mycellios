import { describe, expect, it } from "vitest";
import { createWebPresence } from "./web-presence.js";

function fakeFanout() {
  const subscribers = new Map<string, Set<(payload: string) => void>>();
  const published: string[] = [];
  return {
    published,
    publish: async (topic: string, payload: string) => {
      published.push(payload);
      for (const subscriber of subscribers.get(topic) ?? []) subscriber(payload);
    },
    subscribe: (topic: string, callback: (payload: string) => void) => {
      const set = subscribers.get(topic) ?? new Set();
      set.add(callback);
      subscribers.set(topic, set);
      return Promise.resolve(async () => {
        set.delete(callback);
      });
    },
  };
}

const event = {
  siteId: "site-1",
  botId: "bot-1",
  runId: "run-1",
  path: "index.html",
  phase: "writing" as const,
  target: { kind: "selector" as const, value: "#hero" },
};

describe("createWebPresence", () => {
  it("follows only its own app", async () => {
    const fanout = fakeFanout();
    let clock = 1_000;
    const presence = createWebPresence(fanout as never, () => clock);
    const iterator = presence.follow("site-1")[Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await presence.notify({ ...event, siteId: "site-2", runId: "run-2" });
    clock += 1_000;
    await presence.notify(event);
    expect((await pending).value).toMatchObject({ ...event, at: new Date(2_000).toISOString() });
    await iterator.return?.(undefined);
  });

  it("drops signals faster than one per run every 250 ms and invalid ones", async () => {
    const fanout = fakeFanout();
    let clock = 1_000;
    const presence = createWebPresence(fanout as never, () => clock);
    await presence.notify(event);
    clock += 100;
    await presence.notify(event);
    clock += 200;
    await presence.notify(event);
    await presence.notify({ ...event, runId: "run-9", path: "x".repeat(600) });
    expect(fanout.published).toHaveLength(2);
  });

  it("does nothing without a realtime fanout", async () => {
    await expect(createWebPresence().notify(event)).resolves.toBeUndefined();
  });
});
