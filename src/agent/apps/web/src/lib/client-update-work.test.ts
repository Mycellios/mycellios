// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  call: null as object | null,
  dictation: "idle" as "idle" | "listening" | "transcribing",
}));
vi.mock("./client-build", () => ({ CLIENT_BUILD: "20261022090000" }));
vi.mock("./rpc", () => ({ onRpcResponse: () => () => {} }));
vi.mock("./call-session", () => ({ getSnapshot: () => state.call }));
vi.mock("./dictation", () => ({ dictation: { get state() { return { status: state.dictation }; } } }));
vi.mock("./preload-recovery", () => ({ recoveryReload: vi.fn(() => true) }));

import { clientUpdates } from "./client-update";
import { setComposerUnsavedWork, writeComposerDraft } from "./composer-draft";
import { recoveryReload } from "./preload-recovery";

it("uses live call, recording, transcription, attachment and draft guards before refreshing the real client tracker", async () => {
  const fetch = vi.fn(async () => new Response("20261022100000"));
  vi.stubGlobal("fetch", fetch);
  const updates = clientUpdates();
  const stop = updates.subscribe(() => {});
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(updates.getSnapshot()).toBe("20261022100000");
    for (const status of ["listening", "transcribing"] as const) {
      state.dictation = status;
      expect(await updates.applyUpdate()).toBe(false);
    }
    state.dictation = "idle";
    state.call = {};
    expect(await updates.applyUpdate()).toBe(false);
    state.call = null;
    setComposerUnsavedWork(true);
    expect(await updates.applyUpdate()).toBe(false);
    setComposerUnsavedWork(false);
    writeComposerDraft("bot:update-proof", "Do not lose this message");
    expect(await updates.applyUpdate()).toBe(false);
    expect(localStorage.getItem("rakazo.composerDraft.bot:update-proof")).toBe("Do not lose this message");
    expect(recoveryReload).not.toHaveBeenCalled();
    writeComposerDraft("bot:update-proof", "");
    expect(await updates.applyUpdate()).toBe(true);
    expect(recoveryReload).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/build-id", expect.objectContaining({ cache: "no-store", credentials: "omit", signal: expect.any(AbortSignal) }));
  } finally {
    stop();
    state.call = null;
    state.dictation = "idle";
    setComposerUnsavedWork(false);
    writeComposerDraft("bot:update-proof", "");
    vi.unstubAllGlobals();
  }
});
