// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot, MycelliosDesktop } from "@mycellios/contracts";
const fixture = vi.hoisted(() => ({ avatar: vi.fn(), navigate: vi.fn(), get: vi.fn(), answer: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { threads: { get: fixture.get, answer: fixture.answer } } }));
vi.mock("../lib/companion-avatar", () => ({ companionAvatar: fixture.avatar }));
vi.mock("react-router-dom", () => ({ useNavigate: () => fixture.navigate }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join(""), i18n: { locale: "en" } }) }));
import { DesktopCompanions } from "./DesktopCompanions";
it("revokes the old account before avatar loading and rejects a late snapshot from that account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const publish = vi.fn(async (_snapshot: unknown) => undefined);
  window.mycelliosDesktop = { companions: { publish, onSelect: () => () => {} } } as unknown as MycelliosDesktop;
  let oldAvatar!: (image: undefined) => void;
  fixture.avatar.mockImplementationOnce(() => new Promise(resolve => { oldAvatar = resolve; })).mockResolvedValue(undefined);
  const div = document.createElement("div"); document.body.append(div); const root = createRoot(div);
  const bot = { id: "mico", spaceId: "space", name: "Mico", color: "#3f9f78", status: "idle", preview: "", unread: false } as Bot;
  const oldScope = JSON.stringify(["old-owner", "space"]), newScope = JSON.stringify(["new-owner", "space"]);
  try {
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={oldScope} />));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ scope: oldScope, agents: [] }));
    publish.mockClear();
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={newScope} />));
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ scope: newScope, agents: [] });
    await act(async () => oldAvatar(undefined));
    expect(publish.mock.calls.every(([snapshot]) => (snapshot as any).scope === newScope)).toBe(true);
  } finally {
    await act(async () => root.unmount()); div.remove(); delete window.mycelliosDesktop; vi.unstubAllGlobals();
  }
});

it("re-reads the owned pending question before submitting and ignores a stale account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scope = JSON.stringify(["owner", "space"]);
  const snapshot = { botId: "mico", messages: [{ id: "message", runId: "run", blocks: [{ kind: "ask", text: "Where?", actions: [{ id: "a", label: "Paris" }], status: "pending" }] }], run: { id: "run", status: "waiting_input" } };
  fixture.get.mockResolvedValue(snapshot); fixture.answer.mockResolvedValue({ ok: true }); fixture.avatar.mockResolvedValue(undefined);
  let question!: (request: any) => Promise<void>;
  const questionResult = vi.fn(async () => undefined);
  window.mycelliosDesktop = { companions: { publish: vi.fn(async () => {}), state: vi.fn(async () => ({ island: { shown: false } })),
    onQuestion: (fn: (request: any) => void) => { question = fn as typeof question; return () => {}; }, questionResult, onSelect: () => () => {} } } as unknown as MycelliosDesktop;
  const bot = { id: "mico", spaceId: "space", name: "Mico", color: "#3f9f78", status: "waiting_input", preview: "", unread: false } as Bot;
  const div = document.createElement("div"); const root = createRoot(div);
  try {
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={scope} />));
    const request = { scope, nonce: "nonce", promptId: "run:message:0", prompt: { botId: "mico", runId: "invented" },
      answers: [{ questionId: "question-1", optionIds: ["a"], text: "" }] };
    await act(async () => question(request));
    expect(fixture.answer).toHaveBeenCalledWith({ botId: "mico", runId: "run", messageId: "message", answer: "a", clientNonce: "nonce" });
    expect(questionResult).toHaveBeenCalledWith({ scope, nonce: "nonce", outcome: "ok" });
    fixture.answer.mockClear(); questionResult.mockClear();
    await act(async () => question({ ...request, scope: "foreign" }));
    expect(fixture.answer).not.toHaveBeenCalled(); expect(questionResult).not.toHaveBeenCalled();
    fixture.get.mockResolvedValue({ ...snapshot, run: { id: "run", status: "queued" } });
    await act(async () => question(request));
    expect(fixture.answer).not.toHaveBeenCalled(); expect(questionResult).toHaveBeenCalledWith({ scope, nonce: "nonce", outcome: "stale" });
  } finally { await act(async () => root.unmount()); delete window.mycelliosDesktop; vi.unstubAllGlobals(); }
});

it("reads a waiting Mico's questions once until its roster state changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scope = JSON.stringify(["owner", "space"]);
  const snapshot = { botId: "mico", messages: [{ id: "message", runId: "run", blocks: [{ kind: "ask", text: "Where?", actions: [{ id: "a", label: "Paris" }], status: "pending" }] }], run: { id: "run", status: "waiting_input" } };
  fixture.get.mockReset(); fixture.get.mockResolvedValue(snapshot); fixture.avatar.mockResolvedValue(undefined);
  window.mycelliosDesktop = { companions: { publish: vi.fn(async () => {}), state: vi.fn(async () => ({ island: { shown: true } })),
    onQuestion: () => () => {}, questionResult: vi.fn(async () => undefined), onSelect: () => () => {} } } as unknown as MycelliosDesktop;
  const bot = { id: "mico", spaceId: "space", name: "Mico", color: "#3f9f78", status: "waiting_input", preview: "Where?", unread: false, updatedAt: "2026-01-01T00:00:00.000Z" } as Bot;
  const div = document.createElement("div"); const root = createRoot(div);
  try {
    await act(async () => root.render(<DesktopCompanions bots={[bot]} spaceId="space" scope={scope} />));
    // Each roster refresh hands over a new array with the same state.
    await act(async () => root.render(<DesktopCompanions bots={[{ ...bot }]} spaceId="space" scope={scope} />));
    await act(async () => root.render(<DesktopCompanions bots={[{ ...bot }]} spaceId="space" scope={scope} />));
    expect(fixture.get).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<DesktopCompanions bots={[{ ...bot, updatedAt: "2026-01-01T00:01:00.000Z" }]} spaceId="space" scope={scope} />));
    expect(fixture.get).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); delete window.mycelliosDesktop; vi.unstubAllGlobals(); }
});

it("keeps a waiting Mico's questions across a shell remount in the same scope", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scope = JSON.stringify(["remount-owner", "space"]);
  const snapshot = { botId: "mico", messages: [{ id: "message", runId: "run", blocks: [{ kind: "ask", text: "Where?", actions: [{ id: "a", label: "Paris" }], status: "pending" }] }], run: { id: "run", status: "waiting_input" } };
  fixture.get.mockReset(); fixture.get.mockResolvedValue(snapshot); fixture.avatar.mockResolvedValue(undefined);
  window.mycelliosDesktop = { companions: { publish: vi.fn(async () => {}), state: vi.fn(async () => ({ island: { shown: true } })),
    onQuestion: () => () => {}, questionResult: vi.fn(async () => undefined), onSelect: () => () => {} } } as unknown as MycelliosDesktop;
  const bot = { id: "mico", spaceId: "space", name: "Mico", color: "#3f9f78", status: "waiting_input", preview: "Where?", unread: false, updatedAt: "2026-01-01T00:00:00.000Z" } as Bot;
  try {
    for (const owner of [scope, scope]) {
      const div = document.createElement("div"); const root = createRoot(div);
      await act(async () => root.render(<DesktopCompanions bots={[{ ...bot }]} spaceId="space" scope={owner} />));
      await act(async () => root.unmount());
    }
    expect(fixture.get).toHaveBeenCalledTimes(1);
    // Another account never reuses those questions.
    const div = document.createElement("div"); const root = createRoot(div);
    await act(async () => root.render(<DesktopCompanions bots={[{ ...bot }]} spaceId="space" scope={JSON.stringify(["other-owner", "space"])} />));
    await act(async () => root.unmount());
    expect(fixture.get).toHaveBeenCalledTimes(2);
  } finally { delete window.mycelliosDesktop; vi.unstubAllGlobals(); }
});
