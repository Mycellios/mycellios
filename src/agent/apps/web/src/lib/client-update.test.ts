import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./rpc", () => ({ onRpcResponse: () => () => {} }));
vi.mock("./call-session", () => ({ getSnapshot: () => null }));

import type { ClientUpdateDeps } from "./client-update";
import {
  CLIENT_UPDATE_CHECK_SPACING_MS,
  CLIENT_UPDATE_IDLE_MS,
  CLIENT_UPDATE_REQUIRED_RETRIES,
  createClientUpdates,
} from "./client-update";

const OLD = "20261022090000";
const NEW = "20261022100000";
const NEWER = "20261022110000";

function setup(overrides: Partial<ClientUpdateDeps> = {}) {
  let now = 0;
  const store = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  let onResponse: (response: Response) => void = () => {};
  let tick: () => void = () => {};
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    activeElement: null as unknown as Element | null,
    dialog: false,
  };
  const deps: ClientUpdateDeps = {
    build: OLD,
    document: {
      get visibilityState() {
        return doc.visibilityState;
      },
      get activeElement() {
        return doc.activeElement;
      },
      querySelector: (() => (doc.dialog ? {} : null)) as unknown as Document["querySelector"],
    },
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
      removeItem: (key) => void store.delete(key),
    },
    listen: (type, listener) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
    responses: (listener) => {
      onResponse = listener;
      return () => {};
    },
    servedBuild: vi.fn(async () => NEW as string | null),
    reload: vi.fn(() => true),
    holdsUnsavedWork: vi.fn(() => false),
    hasUnsentDraft: vi.fn(() => false),
    now: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {},
    ...overrides,
  };
  const updates = createClientUpdates(deps);
  const stop = updates.install();
  return {
    deps,
    doc,
    store,
    updates,
    stop,
    advance: (ms: number) => {
      now += ms;
    },
    fire: (type: string) => listeners.get(type)?.(),
    idleTick: () => tick(),
    reply: (status: number, build?: string) =>
      onResponse(new Response(null, { status, headers: build ? { "x-rakazo-build": build } : {} })),
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe("client updates", () => {
  it("announces a served newer build and updates only after explicit apply", async () => {
    const { updates, deps } = setup();
    const notify = vi.fn();
    const stop = updates.subscribe(notify);
    updates.noteServerBuild(NEW);
    await flush();
    expect(updates.getSnapshot()).toBe(NEW);
    expect(notify).toHaveBeenCalledOnce();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(await updates.applyUpdate()).toBe(true);
    stop();
  });

  it("never announces a deployment still serving the old build", async () => {
    const { updates } = setup({ servedBuild: async () => OLD });
    const stop = updates.subscribe(vi.fn());
    updates.noteServerBuild(NEW);
    await flush();
    expect(updates.getSnapshot()).toBeNull();
    expect(await updates.applyUpdate()).toBe(false);
    stop();
  });

  it("protects calls, pending attachments and unsent drafts on manual update", async () => {
    let held = false;
    let draft = false;
    const { updates, deps } = setup({ holdsUnsavedWork: () => held, hasUnsentDraft: () => draft });
    const stop = updates.subscribe(vi.fn());
    updates.noteServerBuild(NEW);
    await flush();
    held = true;
    expect(await updates.applyUpdate()).toBe(false);
    held = false;
    draft = true;
    expect(await updates.applyUpdate()).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    stop();
  });

  it("rechecks unsaved work after fetching the served build", async () => {
    let draft = false;
    const { updates, deps } = setup({ hasUnsentDraft: () => draft });
    const stop = updates.subscribe(vi.fn());
    updates.noteServerBuild(NEW);
    await flush();
    vi.mocked(deps.servedBuild).mockImplementation(async () => { draft = true; return NEW; });
    expect(await updates.applyUpdate()).toBe(false);
    expect(deps.reload).not.toHaveBeenCalled();
    stop();
  });
  it("waits for a safe moment instead of reloading a visible tab at once", async () => {
    const { deps, reply, fire, doc } = setup();
    reply(200, NEW);
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    doc.visibilityState = "hidden";
    fire("visibilitychange");
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("reloads a hidden tab as soon as it learns of a newer build", async () => {
    const { deps, doc, updates } = setup();
    doc.visibilityState = "hidden";
    updates.noteServerBuild(NEW);
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("ignores the same, older, and malformed builds", async () => {
    const { deps, doc, updates } = setup();
    doc.visibilityState = "hidden";
    for (const build of [OLD, "20261001000000", "3c6e209", null, ""])
      updates.noteServerBuild(build);
    await flush();
    expect(deps.servedBuild).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("reloads on navigation, never while a field holds typed text, a dialog is open, or work is unsaved", async () => {
    const holdsUnsavedWork = vi.fn(() => true);
    const { deps, doc, updates, advance } = setup({ holdsUnsavedWork });
    updates.noteServerBuild(NEW);
    updates.navigated();
    holdsUnsavedWork.mockReturnValue(false);
    doc.activeElement = { value: "half a sentence" } as unknown as Element;
    updates.navigated();
    doc.activeElement = { value: "" } as unknown as Element;
    doc.dialog = true;
    updates.navigated();
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    doc.dialog = false;
    advance(1);
    updates.navigated();
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("reloads after idle only with no unsent draft", async () => {
    const hasUnsentDraft = vi.fn(() => true);
    const { deps, updates, advance, idleTick, fire } = setup({ hasUnsentDraft });
    updates.noteServerBuild(NEW);
    advance(CLIENT_UPDATE_IDLE_MS - 1);
    idleTick();
    advance(1);
    idleTick();
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    hasUnsentDraft.mockReturnValue(false);
    fire("keydown");
    advance(CLIENT_UPDATE_IDLE_MS - 1);
    idleTick();
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    advance(1);
    idleTick();
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("waits while the web server still serves the old build, checking at most every 30s", async () => {
    const servedBuild = vi.fn(async () => OLD as string | null);
    const { deps, updates, advance } = setup({ servedBuild });
    updates.noteServerBuild(NEW);
    updates.navigated();
    await flush();
    updates.navigated();
    await flush();
    expect(servedBuild).toHaveBeenCalledOnce();
    expect(deps.reload).not.toHaveBeenCalled();
    servedBuild.mockResolvedValue(NEW);
    advance(CLIENT_UPDATE_CHECK_SPACING_MS);
    updates.navigated();
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("never reloads twice for the same build pair, even across the reload", async () => {
    const first = setup();
    first.updates.noteServerBuild(NEW);
    first.updates.navigated();
    await flush();
    expect(first.deps.reload).toHaveBeenCalledOnce();
    // The page came back on the same old bundle (a cache, or a desktop bundled renderer).
    const store = first.store;
    const again = setup({
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
        removeItem: (key) => void store.delete(key),
      },
    });
    again.doc.visibilityState = "hidden";
    again.updates.noteServerBuild(NEW);
    again.updates.updateRequired();
    await flush();
    expect(again.deps.reload).not.toHaveBeenCalled();
    // A later deployment is a new target and gets one more try.
    vi.mocked(again.deps.servedBuild).mockResolvedValue(NEWER);
    again.advance(CLIENT_UPDATE_CHECK_SPACING_MS);
    again.updates.noteServerBuild(NEWER);
    await flush();
    expect(again.deps.reload).toHaveBeenCalledOnce();
  });

  it("preserves text even when the server requires an update, then retries safely", async () => {
    const { deps, doc, reply, idleTick } = setup();
    doc.activeElement = { value: "typing" } as unknown as Element;
    reply(426, NEW);
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    doc.activeElement = null;
    idleTick();
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
  });

  it("does not reload if the moment stopped being safe while it checked the server", async () => {
    let resolve!: (build: string | null) => void;
    const servedBuild = vi.fn(() => new Promise<string | null>((done) => (resolve = done)));
    const { deps, doc, updates } = setup({ servedBuild });
    updates.noteServerBuild(NEW);
    updates.navigated();
    doc.dialog = true;
    resolve(NEW);
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("tries the same build pair again when the recovery guard refused the reload", async () => {
    const reload = vi.fn(() => false);
    const { updates, advance } = setup({ reload });
    updates.noteServerBuild(NEW);
    updates.navigated();
    await flush();
    reload.mockReturnValue(true);
    advance(CLIENT_UPDATE_CHECK_SPACING_MS);
    updates.navigated();
    await flush();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps checking after a refusal while the rollout still serves the old build, then stops", async () => {
    const servedBuild = vi.fn(async () => OLD as string | null);
    const { deps, reply, idleTick } = setup({ servedBuild });
    reply(426);
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
    idleTick();
    await flush();
    servedBuild.mockResolvedValue(NEW);
    idleTick();
    await flush();
    expect(deps.reload).toHaveBeenCalledOnce();
    servedBuild.mockClear();
    for (let i = 0; i < CLIENT_UPDATE_REQUIRED_RETRIES + 2; i++) {
      idleTick();
      await flush();
    }
    expect(servedBuild.mock.calls.length).toBeLessThanOrEqual(CLIENT_UPDATE_REQUIRED_RETRIES);
  });

  it("stays off without a build id (the dev server)", async () => {
    const { deps, doc, updates } = setup({ build: "" });
    doc.visibilityState = "hidden";
    updates.noteServerBuild(NEW);
    updates.updateRequired();
    await flush();
    expect(deps.servedBuild).not.toHaveBeenCalled();
  });

  it("discovers a web-only deployment without any newer API response", async () => {
    const { updates, deps } = setup();
    const stop = updates.subscribe(vi.fn());
    await flush();
    expect(updates.getSnapshot()).toBe(NEW);
    expect(deps.reload).not.toHaveBeenCalled();
    stop();
  });

  it("detects the next web deployment while the page stays open", async () => {
    const servedBuild = vi.fn(async () => OLD as string | null);
    const { updates, idleTick } = setup({ servedBuild });
    const stop = updates.subscribe(vi.fn());
    await flush();
    expect(updates.getSnapshot()).toBeNull();
    servedBuild.mockResolvedValue(NEW);
    idleTick();
    await flush();
    expect(updates.getSnapshot()).toBe(NEW);
    servedBuild.mockResolvedValue(NEWER);
    idleTick();
    await flush();
    expect(updates.getSnapshot()).toBe(NEWER);
    stop();
  });

  it("checks again on foregrounding and retries a failed version request", async () => {
    const servedBuild = vi.fn(async () => null as string | null);
    const { updates, doc, fire, idleTick } = setup({ servedBuild });
    const stop = updates.subscribe(vi.fn());
    await flush();
    servedBuild.mockRejectedValueOnce(new Error("offline"));
    idleTick();
    await flush();
    expect(updates.getSnapshot()).toBeNull();
    doc.visibilityState = "hidden";
    servedBuild.mockResolvedValue(NEW);
    idleTick();
    await flush();
    expect(updates.getSnapshot()).toBeNull();
    doc.visibilityState = "visible";
    fire("visibilitychange");
    await flush();
    expect(updates.getSnapshot()).toBe(NEW);
    stop();
  });

  it("keeps unfocused drafts on hidden, navigation and required reloads", async () => {
    const { updates, doc, deps, fire } = setup({ hasUnsentDraft: () => true });
    updates.noteServerBuild(NEW);
    updates.navigated();
    doc.visibilityState = "hidden";
    fire("visibilitychange");
    updates.updateRequired();
    await flush();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("allows refreshing while server work runs without calling a task mutation", async () => {
    // Client reload is the only effect: no stop, cancel, retry or send API exists here.
    const { updates, deps } = setup();
    const stop = updates.subscribe(vi.fn());
    await flush();
    expect(await updates.applyUpdate()).toBe(true);
    expect(deps.reload).toHaveBeenCalledOnce();
    stop();
  });
});
