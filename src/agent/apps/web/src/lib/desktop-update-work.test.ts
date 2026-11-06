// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ call: null as object | null, dictation: "idle" }));
vi.mock("./call-session", () => ({ getSnapshot: () => state.call }));
vi.mock("./dictation", () => ({ dictation: { get state() { return { status: state.dictation }; } } }));
import { beginComposerDraftSubmission, composerHoldsUnsavedWork, readComposerDraft,
  setComposerUnsavedWork, settleComposerDraftSubmission, writeComposerDraft } from "./composer-draft";
import { canRestartDesktop } from "./desktop-update-work";
afterEach(() => { document.body.innerHTML = ""; state.call = null; state.dictation = "idle"; setComposerUnsavedWork(false); writeComposerDraft("update-fixture", ""); });
it("preserves saved text without requiring the user to discard or send it", () => {
  writeComposerDraft("update-fixture", "Unsent text must survive");
  expect(canRestartDesktop()).toBe(true);
  expect(readComposerDraft("update-fixture")).toBe("Unsent text must survive");
});
it("waits for sends, attachments, calls, recordings and forms", () => {
  for (const status of ["listening", "transcribing"]) { state.dictation = status; expect(canRestartDesktop()).toBe(false); }
  state.dictation = "idle"; state.call = {}; expect(canRestartDesktop()).toBe(false); state.call = null;
  setComposerUnsavedWork(true); expect(canRestartDesktop()).toBe(false); setComposerUnsavedWork(false);
  const submission = beginComposerDraftSubmission("update-fixture", "pending");
  expect(canRestartDesktop()).toBe(false); settleComposerDraftSubmission("update-fixture", submission, false);
  document.body.innerHTML = '<div role="dialog">Unfinished form</div>'; expect(canRestartDesktop()).toBe(false);
  document.body.innerHTML = '<div role="dialog"><section data-testid="desktop-update-settings"></section></div>';
  expect(canRestartDesktop()).toBe(true);
});
it("keeps a failed storage write in memory and retries persistence before permitting restart", () => {
  writeComposerDraft("update-fixture", "Recovered text", { getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => {} });
  expect(composerHoldsUnsavedWork()).toBe(true);
  expect(canRestartDesktop()).toBe(true);
  expect(readComposerDraft("update-fixture")).toBe("Recovered text");
});
