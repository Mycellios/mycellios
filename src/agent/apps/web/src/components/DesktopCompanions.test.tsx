// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot, RakazoDesktop } from "@rakazo/contracts";
const fixture = vi.hoisted(() => ({ avatar: vi.fn(), navigate: vi.fn(), get: vi.fn(), answer: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { threads: { get: fixture.get, answer: fixture.answer } } }));
vi.mock("../lib/companion-avatar", () => ({ companionAvatar: fixture.avatar }));
vi.mock("react-router-dom", () => ({ useNavigate: () => fixture.navigate }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join(""), i18n: { locale: "en" } }) }));
import { DesktopCompanions } from "./DesktopCompanions";
it("revokes the old account before avatar loading and rejects a late snapshot from that account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const publish = vi.fn(async (_snapshot: unknown) => undefined);
  window.rakazoDesktop = { companions: { publish, onSelect: () => () => {} } } as unknown as RakazoDesktop;
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
    await act(async () => root.unmount()); div.remove(); delete window.rakazoDesktop; vi.unstubAllGlobals();
  }
});

it("re-reads the owned pending question before submitting and ignores a stale account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scope = JSON.stringify(["owner", "space"]);
  const snapshot = { botId: "mico", messages: [{ id: "message", runId: "run", blocks: [{ kind: "ask", text: "Where?", actions: [{ id: "a", label: "Paris" }], status: "pending" }] }], run: { id: "run", status: "waiting_input" } };
  fixture.get.mockResolvedValue(snapshot); fixture.answer.mockResolvedValue({ ok: true }); fixture.avatar.mockResolvedValue(undefined);
  let question!: (request: any) => Promise<void>;
  const questionResult = vi.fn(async () => undefined);
  window.rakazoDesktop = { companions: { publish: vi.fn(async () => {}), state: vi.fn(async () => ({ island: { shown: false } })),
    onQuestion: (fn: (request: any) => void) => { question = fn as typeof question; return () => {}; }, questionResult, onSelect: () => () => {} } } as unknown as RakazoDesktop;
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
  } finally { await act(async () => root.unmount()); delete window.rakazoDesktop; vi.unstubAllGlobals(); }
});
