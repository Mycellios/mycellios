/** Per-thread composer draft persistence (survives tab reloads and discards). */
import { hasUnsavedEditorWork } from "./unsaved-editor-work";

export const COMPOSER_DRAFT_STORAGE_PREFIX = "mycellios.composerDraft.";

type ComposerDraftSubmission = { text: string };
const pendingSubmissions = new Map<string, ComposerDraftSubmission>();
const failedDraftWrites = new Map<string, string>();
const acceptedListeners = new Map<string, Set<(text: string) => void>>();
const queuedDraftWrites = new Map<string, string>();
let draftWriteTimer: ReturnType<typeof setTimeout> | undefined;
let lifecycleInstalled = false;

/** Keep keystrokes in memory immediately; batch synchronous storage off the input event. */
export function scheduleComposerDraft(threadKey: string, draft: string): void {
  if (!threadKey) return;
  pendingSubmissions.delete(threadKey);
  queuedDraftWrites.set(threadKey, draft);
  if (!lifecycleInstalled && typeof window !== "undefined") {
    lifecycleInstalled = true;
    window.addEventListener("pagehide", flushComposerDrafts);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushComposerDrafts();
    });
  }
  // A fixed window also persists during continuous typing, not just after a pause.
  draftWriteTimer ??= setTimeout(() => { draftWriteTimer = undefined; flushComposerDrafts(); }, 150);
}

export function beginComposerDraftSubmission(
  threadKey: string,
  text: string,
): ComposerDraftSubmission {
  writeComposerDraft(threadKey, text);
  const submission = { text };
  pendingSubmissions.set(threadKey, submission);
  return submission;
}

export function settleComposerDraftSubmission(
  threadKey: string,
  submission: ComposerDraftSubmission,
  accepted: boolean,
): void {
  if (pendingSubmissions.get(threadKey) !== submission) return;
  pendingSubmissions.delete(threadKey);
  if (!accepted || readComposerDraft(threadKey) !== submission.text) return;
  writeComposerDraft(threadKey, "");
  for (const listener of acceptedListeners.get(threadKey) ?? []) listener(submission.text);
}

let unsavedWork = false;

/**
 * The shell reports work a reload would lose: a send (typed or spoken) until the server answers,
 * or picked attachments, which live only in memory.
 */
export function setComposerUnsavedWork(pending: boolean): void {
  unsavedWork = pending;
}

/** A send waiting for its answer, or attachments that only exist in memory. */
export function composerHoldsUnsavedWork(): boolean {
  return pendingSubmissions.size > 0 || unsavedWork || queuedDraftWrites.size > 0 || failedDraftWrites.size > 0 || hasUnsavedEditorWork();
}

/** Unsaved composer work, or saved text in any composer that has not been sent. */
export function hasUnsentComposerDraft(storage: Storage | null = null): boolean {
  if (composerHoldsUnsavedWork()) return true;
  try {
    const drafts = storage ?? localStorage;
    for (let index = 0; index < drafts.length; index++) {
      const key = drafts.key(index);
      if (key?.startsWith(COMPOSER_DRAFT_STORAGE_PREFIX) && drafts.getItem(key)) return true;
    }
  } catch {
    // Without storage the draft lives only in memory, so treat it as unsent.
    return true;
  }
  return false;
}

export function subscribeComposerDraftAccepted(
  threadKey: string,
  listener: (text: string) => void,
): () => void {
  let listeners = acceptedListeners.get(threadKey);
  if (!listeners) {
    listeners = new Set();
    acceptedListeners.set(threadKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) acceptedListeners.delete(threadKey);
  };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getLocalStorage(): DraftStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function composerDraftStorageKey(threadKey: string): string {
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${threadKey}`;
}

export function readComposerDraft(
  threadKey: string,
  storage: DraftStorage | null = getLocalStorage(),
): string {
  if (queuedDraftWrites.has(threadKey)) return queuedDraftWrites.get(threadKey)!;
  if (failedDraftWrites.has(threadKey)) return failedDraftWrites.get(threadKey)!;
  if (!storage || !threadKey) return "";
  try {
    return storage.getItem(composerDraftStorageKey(threadKey)) ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(
  threadKey: string,
  draft: string,
  storage: DraftStorage | null = getLocalStorage(),
): void {
  pendingSubmissions.delete(threadKey);
  queuedDraftWrites.delete(threadKey);
  if (!threadKey) return;
  if (!storage) { failedDraftWrites.set(threadKey, draft); return; }
  try {
    if (draft.length === 0) storage.removeItem(composerDraftStorageKey(threadKey));
    else storage.setItem(composerDraftStorageKey(threadKey), draft);
    failedDraftWrites.delete(threadKey);
  } catch {
    // Quota or private-mode failures: the draft still lives in memory.
    failedDraftWrites.set(threadKey, draft);
  }
}

/** Retry only failed persistence; never settle or resend an in-flight submission. */
export function flushComposerDrafts(): boolean {
  if (draftWriteTimer !== undefined) { clearTimeout(draftWriteTimer); draftWriteTimer = undefined; }
  for (const [key, value] of queuedDraftWrites) {
    queuedDraftWrites.delete(key);
    failedDraftWrites.set(key, value);
  }
  const storage = getLocalStorage();
  if (!storage) return false;
  for (const [key, value] of failedDraftWrites) {
    try {
      if (value) storage.setItem(composerDraftStorageKey(key), value);
      else storage.removeItem(composerDraftStorageKey(key));
      failedDraftWrites.delete(key);
    } catch { return false; }
  }
  return true;
}
