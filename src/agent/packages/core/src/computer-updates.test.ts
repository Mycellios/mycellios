import type { ComputerUpdate } from "@mycellios/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPUTER_UPDATES_ACTIVE_POLL_MS,
  COMPUTER_UPDATES_IDLE_POLL_MS,
  computerUpdatesPollInterval,
  createComputerUpdates,
} from "./computer-updates.js";

const update: ComputerUpdate = {
  id: "update-1",
  botId: "bot-1",
  name: "Writer",
  mode: "team",
  action: "update",
  status: "running",
  stage: "saving",
};
afterEach(() => vi.useRealTimers());
describe("computer update presentation", () => {
  it("keeps a newly started update when an older poll returns, and closing does not stop polling", async () => {
    vi.useFakeTimers();
    let resolve!: (rows: ComputerUpdate[]) => void;
    const list = vi.fn(
      () =>
        new Promise<ComputerUpdate[]>((done) => {
          resolve = done;
        }),
    );
    const store = createComputerUpdates({
      list,
      start: async () => update,
      dismiss: async () => {},
    });
    const stop = store.watch();
    await store.start("bot-1");
    resolve([]);
    await Promise.resolve();
    expect(store.getSnapshot()).toEqual({ updates: [update], openId: update.id });
    store.open(null);
    await vi.advanceTimersByTimeAsync(1500);
    resolve([{ ...update, stage: "restoring" }]);
    await Promise.resolve();
    expect(store.getSnapshot()).toEqual({
      updates: [{ ...update, stage: "restoring" }],
      openId: null,
    });
    stop();
  });
  it("restores background progress on a new mount and ignores responses after disposal", async () => {
    vi.useFakeTimers();
    const store = createComputerUpdates({
      list: async () => [update],
      start: async () => update,
      dismiss: async () => {},
    });
    let stop = store.watch();
    await Promise.resolve();
    expect(store.getSnapshot().updates).toEqual([update]);
    stop();
    stop = store.watch();
    stop();
    await Promise.resolve();
    expect(store.getSnapshot().updates).toEqual([]);
  });
  it("stops polling on a 401 and resumes on the next watch", async () => {
    vi.useFakeTimers();
    const list = vi.fn(async (): Promise<ComputerUpdate[]> => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    });
    const store = createComputerUpdates({
      list,
      start: async () => update,
      dismiss: async () => {},
    });
    let stop = store.watch();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
    list.mockResolvedValue([]);
    stop = store.watch();
    await vi.advanceTimersByTimeAsync(COMPUTER_UPDATES_IDLE_POLL_MS);
    expect(list).toHaveBeenCalledTimes(3);
    stop();
  });
  it("stops polling when the server refuses this build", async () => {
    vi.useFakeTimers();
    const list = vi.fn(async (): Promise<ComputerUpdate[]> => {
      throw Object.assign(new Error("Update required"), { status: 426 });
    });
    const stop = createComputerUpdates({
      list,
      start: async () => update,
      dismiss: async () => {},
    }).watch();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
  });
  it("keeps polling through other failures", async () => {
    vi.useFakeTimers();
    const list = vi.fn(async (): Promise<ComputerUpdate[]> => {
      throw Object.assign(new Error("Unavailable"), { status: 503 });
    });
    const stop = createComputerUpdates({
      list,
      start: async () => update,
      dismiss: async () => {},
    }).watch();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(list).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("computer update polling", () => {
  it("follows queued, running and interrupted operations closely and slows down otherwise", () => {
    expect(computerUpdatesPollInterval([{ status: "failed" }, { status: "running" }])).toBe(
      COMPUTER_UPDATES_ACTIVE_POLL_MS,
    );
    expect(computerUpdatesPollInterval([{ status: "queued" }])).toBe(
      COMPUTER_UPDATES_ACTIVE_POLL_MS,
    );
    expect(computerUpdatesPollInterval([{ status: "interrupted" }])).toBe(
      COMPUTER_UPDATES_ACTIVE_POLL_MS,
    );
    expect(computerUpdatesPollInterval([])).toBe(COMPUTER_UPDATES_IDLE_POLL_MS);
    expect(computerUpdatesPollInterval([{ status: "failed" }])).toBe(COMPUTER_UPDATES_IDLE_POLL_MS);
  });

  it("checks rarely while idle and closely once this client starts an update", async () => {
    vi.useFakeTimers();
    let rows: ComputerUpdate[] = [];
    const list = vi.fn(async () => rows);
    const store = createComputerUpdates({
      list,
      start: async () => {
        rows = [update];
        return update;
      },
      dismiss: async () => {},
    });
    const stop = store.watch();
    await vi.advanceTimersByTimeAsync(COMPUTER_UPDATES_IDLE_POLL_MS - 1);
    expect(list).toHaveBeenCalledTimes(1);
    await store.start("bot-1");
    expect(store.getSnapshot().updates).toEqual([update]);
    await vi.advanceTimersByTimeAsync(COMPUTER_UPDATES_ACTIVE_POLL_MS * 2);
    expect(list).toHaveBeenCalledTimes(3);
    rows = [{ ...update, status: "failed" }];
    await vi.advanceTimersByTimeAsync(COMPUTER_UPDATES_ACTIVE_POLL_MS * 4);
    expect(list).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot().updates).toEqual(rows);
    stop();
  });

  it("waits while hidden and checks once as soon as it is shown again", async () => {
    vi.useFakeTimers();
    let hidden = false;
    const shown = new Set<() => void>();
    const list = vi.fn(async () => [update]);
    const stop = createComputerUpdates({
      list,
      start: async () => update,
      dismiss: async () => {},
      visibility: {
        hidden: () => hidden,
        subscribe(listener) {
          shown.add(listener);
          return () => shown.delete(listener);
        },
      },
    }).watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(1);
    hidden = true;
    for (const listener of shown) listener();
    await vi.advanceTimersByTimeAsync(COMPUTER_UPDATES_IDLE_POLL_MS * 2);
    expect(list).toHaveBeenCalledTimes(1);
    hidden = false;
    for (const listener of shown) listener();
    for (const listener of shown) listener();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(2);
    stop();
    expect(shown.size).toBe(0);
  });
});
