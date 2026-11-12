import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_COMPANIONS, DesktopCompanionPreferencesSchema, DesktopCompanionSnapshotSchema } from "@rakazo/contracts";
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Function>(), listeners: new Map<string, Function>(), windows: [] as any[],
  write: vi.fn(async () => undefined), read: vi.fn(async () => null), displays: [{ id: 1, label: "Primary", size: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] }));
vi.mock("./setup-store.js", () => ({ readPrivateFile: mocks.read, writePrivateFile: mocks.write }));
vi.mock("electron", () => ({
  ipcMain: { handle: (key: string, fn: Function) => mocks.handlers.set(key, fn), on: (key: string, fn: Function) => mocks.listeners.set(key, fn), removeListener: vi.fn() },
  screen: { getAllDisplays: () => mocks.displays, getPrimaryDisplay: () => mocks.displays[0], getCursorScreenPoint: () => ({ x: 0, y: 0 }), on: vi.fn(), off: vi.fn() },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: vi.fn(), setWindowOpenHandler: vi.fn(), mainFrame: {} });
    destroyed = false; setAlwaysOnTop = vi.fn(); setHasShadow = vi.fn(); setFocusable = vi.fn(); focus = vi.fn(); setBounds = vi.fn(); showInactive = vi.fn(); setIgnoreMouseEvents = vi.fn();
    getBounds() { return this.options; }
    constructor(public options: any) { super(); mocks.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    async loadFile() { this.webContents.emit("did-finish-load"); }
  },
}));
import { companionBounds, installDesktopCompanions } from "./desktop-companions";
const good = { trusted: true };
const snapshot = { scope: "user:space", theme: "light", agents: [{ id: "bot-a", name: "Mico", color: "#3f9f78", status: "Working", result: "Private preview", working: true, unread: false }] };
const call = (key: string, value?: unknown, event = good) => mocks.handlers.get(`desktop.companions.${key}`)!(event, value);
beforeEach(() => { mocks.windows.length = 0; mocks.handlers.clear(); mocks.listeners.clear(); mocks.write.mockClear(); mocks.read.mockResolvedValue(null); });
it("positions dock and island inside offset display work areas", () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1040 };
  const bounds = companionBounds(area, "dock", DEFAULT_DESKTOP_COMPANIONS, 3);
  expect(bounds.x).toBe(-76); expect(bounds.y).toBeGreaterThanOrEqual(-200);
  const island = companionBounds(area, "island", DEFAULT_DESKTOP_COMPANIONS, 1);
  expect(island.x).toBe(-1100); expect(island.y).toBe(-192);
});
it("requires a trusted main frame, validates payloads and never exposes native capabilities to an external page", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  expect(() => call("state", undefined, {} as typeof good)).toThrow();
  expect(() => call("publish", { ...snapshot, agents: [{ ...snapshot.agents[0], color: "url(https://external)" }] })).toThrow();
  expect(DesktopCompanionSnapshotSchema.safeParse({ ...snapshot, agents: Array(101).fill(snapshot.agents[0]) }).success).toBe(false);
  expect(DesktopCompanionPreferencesSchema.safeParse({ ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, width: 0 } }).success).toBe(false);
  host.dispose();
});
it("publishes only opted-in previews and accepts selections only from its own windows", async () => {
  const reveal = vi.fn(); const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal });
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true } });
  call("publish", snapshot);
  const window = mocks.windows[0]!;
  expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(window.webContents.send.mock.calls.at(-1)[1].snapshot.agents[0].result).toBe("");
  mocks.listeners.get("companion.select")!({ sender: {}, senderFrame: null }, "bot-a"); expect(reveal).not.toHaveBeenCalled();
  mocks.listeners.get("companion.select")!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, "not-owned"); expect(reveal).not.toHaveBeenCalled();
  mocks.listeners.get("companion.select")!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, "bot-a");
  expect(reveal).toHaveBeenCalledWith({ scope: "user:space", botId: "bot-a" });
  host.clear(); expect(window.destroyed).toBe(true); host.dispose();
});
it("keeps a failed save out of the active native state and creates no empty dock", async () => {
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal: vi.fn() });
  mocks.write.mockRejectedValueOnce(new Error("disk"));
  await expect(call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true } })).rejects.toThrow("disk");
  expect(call("state").dock.shown).toBe(false);
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, dock: { ...DEFAULT_DESKTOP_COMPANIONS.dock, shown: true, agents: { "bot-a": false } } });
  call("publish", snapshot); expect(mocks.windows).toHaveLength(0); host.dispose();
});

it("opens only a Mico in the current snapshot and supports the floating dock preference", async () => {
  const openChat = vi.fn(async () => undefined);
  const host = await installDesktopCompanions({ profile: "test", allowed: event => event === good, reveal: vi.fn(), openChat });
  call("publish", snapshot);
  await call("openChat", { scope: snapshot.scope, botId: "bot-a" });
  expect(openChat).toHaveBeenCalledWith({ scope: snapshot.scope, botId: "bot-a" });
  expect(() => call("openChat", { scope: "another-user", botId: "bot-a" })).toThrow();
  expect(() => call("openChat", { scope: snapshot.scope, botId: "other-bot" })).toThrow();
  expect(DesktopCompanionPreferencesSchema.parse({
    ...DEFAULT_DESKTOP_COMPANIONS,
    dock: { shown: false, edge: "right", display: "primary", autoHide: false, edgeStrip: true, results: false, agents: {} },
  }).dock.chatAction).toBe("main");
  host.dispose();
});

const question = { id: "run:message:0", botId: "bot-a", runId: "run", messageId: "message", legacy: true,
  questions: [{ id: "q", question: "Which city?", options: [{ id: "a", label: "Paris" }, { id: "b", label: "London" }] }] };
const answer = { scope: snapshot.scope, promptId: question.id, nonce: "reply-1", answers: [{ questionId: "q", optionIds: ["a"], text: "" }] };
async function islandHost() {
  const requestReply = vi.fn(); const reveal = vi.fn();
  const host = await installDesktopCompanions({ profile: "test", allowed: e => e === good, reveal, requestReply });
  await call("save", { ...DEFAULT_DESKTOP_COMPANIONS, island: { ...DEFAULT_DESKTOP_COMPANIONS.island, shown: true } });
  call("publish", { ...snapshot, questions: [question] });
  const window = mocks.windows[0]!;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { host, requestReply, reveal, window, event };
}
it("answers only from its own island, validates scope/options and resolves through the trusted app", async () => {
  const test = await islandHost(); const reply = mocks.handlers.get("companion.answer")!;
  try {
    expect(() => reply({ sender: {}, senderFrame: null }, answer)).toThrow();
    expect(() => reply(test.event, { ...answer, scope: "foreign" })).toThrow();
    expect(() => reply(test.event, { ...answer, answers: [{ questionId: "q", optionIds: ["admin"], text: "" }] })).toThrow();
    const pending = reply(test.event, answer);
    expect(test.requestReply).toHaveBeenCalledExactlyOnceWith({ ...answer, prompt: question });
    expect(reply(test.event, answer)).toBe(pending);
    expect(() => reply(test.event, { ...answer, answers: [{ questionId: "q", optionIds: ["b"], text: "" }] })).toThrow();
    expect(() => call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" }, {} as typeof good)).toThrow();
    call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" });
    expect(await pending).toBe("ok");
    expect(test.window.webContents.send.mock.calls.at(-1)[1].snapshot.questions).toEqual([]);
  } finally { test.host.dispose(); }
});
it("collapses with Later without discarding the question and opens the correct chat", async () => {
  const test = await islandHost();
  try {
    mocks.listeners.get("companion.expand")!(test.event, true);
    expect(test.window.setBounds.mock.calls.at(-1)[0]).toMatchObject({ width: 560, height: 400 });
    mocks.listeners.get("companion.expand")!(test.event, false);
    expect(test.window.setBounds.mock.calls.at(-1)[0]).toMatchObject({ width: 280, height: 44 });
    expect(test.window.webContents.send.mock.calls.at(-1)[1].snapshot.questions).toHaveLength(1);
    expect(test.requestReply).not.toHaveBeenCalled();
    mocks.listeners.get("companion.question.open")!(test.event, question.id);
    expect(test.reveal).toHaveBeenCalledWith({ scope: snapshot.scope, botId: "bot-a", respond: true });
  } finally { test.host.dispose(); }
});
it("revokes in-flight replies on account exit and rejects foreign question owners", async () => {
  const test = await islandHost();
  try {
    expect(() => call("publish", { ...snapshot, questions: [{ ...question, botId: "foreign" }] })).toThrow();
    const pending = mocks.handlers.get("companion.answer")!(test.event, answer);
    test.host.clear(); expect(await pending).toBe("stale");
    call("questionResult", { nonce: answer.nonce, scope: snapshot.scope, outcome: "ok" });
    expect(test.window.destroyed).toBe(true);
  } finally { test.host.dispose(); }
});

it("does not exhaust the in-flight limit after successive completed answers", async () => {
  const test = await islandHost();
  try {
    for (let index = 0; index < 12; index++) {
      const nextQuestion = { ...question, id: `question-${index}` };
      call("publish", { ...snapshot, questions: [nextQuestion] });
      const nextAnswer = { ...answer, nonce: `nonce-${index}`, promptId: nextQuestion.id };
      const pending = mocks.handlers.get("companion.answer")!(test.event, nextAnswer);
      call("questionResult", { nonce: nextAnswer.nonce, scope: snapshot.scope, outcome: "ok" });
      expect(await pending).toBe("ok");
    }
  } finally { test.host.dispose(); }
});
