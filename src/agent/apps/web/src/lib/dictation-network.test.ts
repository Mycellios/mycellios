// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const session = vi.hoisted(() => vi.fn());
vi.mock("./auth", () => ({ authClient: { getSession: session } }));
import { Dictation } from "./dictation";
import { GENERAL_PREFERENCES_KEY } from "./general-preferences";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); session.mockReset(); });
it("cannot start capture after account confirmation resolves into a cancelled dictation", async () => {
  localStorage.setItem(GENERAL_PREFERENCES_KEY, JSON.stringify({ networkTranscriptionAccount: "owner" }));
  let resolve!: (value: unknown) => void;
  session.mockReturnValue(new Promise(r => { resolve = r; }));
  const getUserMedia = vi.fn(); Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  const dictation = new Dictation(); const listening = dictation.listen({ mode: "hold", botId: "mico", onFinal: vi.fn() });
  dictation.stop("cancel"); resolve({ data: { user: { id: "owner" } } }); await listening;
  expect(getUserMedia).not.toHaveBeenCalled(); expect(dictation.state.status).toBe("idle");
});
it("never inherits another account's network-audio consent", async () => {
  localStorage.setItem(GENERAL_PREFERENCES_KEY, JSON.stringify({ networkTranscriptionAccount: "other" }));
  session.mockResolvedValue({ data: { user: { id: "owner" } } });
  const getUserMedia = vi.fn(); Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  const dictation = new Dictation(); await dictation.listen({ mode: "hold", botId: "mico", onFinal: vi.fn() });
  expect(getUserMedia).not.toHaveBeenCalled(); expect(dictation.state.error).toContain("this account");
});
