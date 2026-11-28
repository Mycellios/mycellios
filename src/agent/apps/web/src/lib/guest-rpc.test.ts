// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductEvent } from "@mycellios/contracts";

const api = vi.hoisted(() => ({ status: vi.fn(), enter: vi.fn(), chat: vi.fn(), config: vi.fn() }));
vi.mock("./guest-chat", async original => ({
  ...(await original<typeof import("./guest-chat")>()),
  guestApi: api,
}));

const limits = { messagesPerSession: 12, messageChars: 4000, historyMessages: 24, historyBytes: 98_304 };
type Modules = { rpc: typeof import("./guest-rpc"); mode: typeof import("./guest-mode"); chat: typeof import("./guest-chat") };

/** guest-rpc keeps the tab's guest state in module scope; every test starts from a fresh module. */
async function load(): Promise<Modules> {
  vi.resetModules();
  const mode = await import("./guest-mode");
  mode.activateGuestMode(limits);
  return { rpc: await import("./guest-rpc"), mode, chat: await import("./guest-chat") };
}

/** Reads the guest event stream until `done` matches, like the shell's subscription. */
async function events(rpc: Modules["rpc"], done: (event: ProductEvent) => boolean, cursor = 0) {
  const controller = new AbortController();
  const stream = await rpc.guestCall(["threads", "subscribe"], { cursor }, { signal: controller.signal }) as AsyncIterable<ProductEvent>;
  const seen: ProductEvent[] = [];
  const timer = setTimeout(() => controller.abort(), 8000);
  for await (const event of stream) { seen.push(event); if (done(event)) break; }
  clearTimeout(timer); controller.abort();
  return seen;
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks();
  api.status.mockResolvedValue({ remaining: 12, limit: 12, expiresAt: Date.now() + 3_600_000 });
  // The guest shell never calls the Agent API.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("the guest shell must not call the network directly"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("guest data layer", () => {
  it("answers the shell from the browser and refuses everything that needs an account", async () => {
    const { rpc, mode } = await load();
    const bootstrap = await rpc.guestCall(["bootstrap"], {}) as { me: { userId: string }; bots: Array<{ id: string; modelId: string }>; thread: { messages: unknown[] } };
    expect(bootstrap.me.userId).toBe(mode.GUEST_USER_ID);
    expect(bootstrap.bots.map(bot => [bot.id, bot.modelId])).toEqual([[mode.GUEST_BOT_ID, "mycellios/managed/free"]]);
    expect(bootstrap.thread.messages).toEqual([]);
    for (const path of [["settings", "get"], ["bots", "create"], ["memory", "list"], ["artifacts", "upload"]])
      await expect(rpc.guestCall(path, {})).rejects.toBeInstanceOf(mode.GuestAccountRequiredError);
    await expect(rpc.guestCall(["threads", "send"], { botId: mode.GUEST_BOT_ID, text: "mira", artifactIds: ["a"] }))
      .rejects.toBeInstanceOf(mode.GuestAccountRequiredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("streams a turn and keeps the run state the shell rereads after it ends", async () => {
    const { rpc } = await load();
    api.chat.mockImplementation(async (_input, onText: (text: string) => void) => { onText("Ho"); return { status: "completed", content: "Hola", remaining: 11 }; });
    const sent = await rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Hola Mico", clientNonce: "nonce-1" }) as { runId: string };
    const seen = await events(rpc, event => event.type === "run.completed");
    expect(seen.map(event => event.type)).toEqual(["thread.message.created", "run.started", "thread.progress", "thread.message.created", "run.completed"]);
    expect(seen[0]!.payload).toMatchObject({ role: "user", clientNonce: "nonce-1" });
    expect(seen.every(event => event.runId === sent.runId)).toBe(true);
    const snapshot = await rpc.guestCall(["threads", "get"], {}) as { messages: Array<{ role: string }>; run: { status: string } };
    expect(snapshot.messages.map(message => message.role)).toEqual(["user", "bot"]);
    expect(snapshot.run.status).toBe("completed");
    // The whole conversation travels with the next turn.
    api.chat.mockResolvedValue({ status: "completed", content: "Claro", remaining: 10 });
    await rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "¿Y ahora?" });
    await events(rpc, event => event.type === "run.completed", snapshot.messages.length + 3);
    expect(api.chat.mock.calls[1]![0].messages.map((m: { content: string }) => m.content)).toEqual(["Hola Mico", "Hola", "¿Y ahora?"]);
  });

  it("keeps a failure visible after the shell rereads, and retries with the same key", async () => {
    const { rpc, chat } = await load();
    api.chat.mockRejectedValue(new chat.GuestChatRequestError("guest_connection_lost"));
    const { runId } = await rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Hola" }) as { runId: string };
    const failed = await events(rpc, event => event.type === "run.failed");
    expect(failed.at(-1)!.payload.error).toEqual(expect.any(String));
    // One quiet retry first, then the visible error: never a silent hang.
    expect(api.chat).toHaveBeenCalledTimes(2);
    const snapshot = await rpc.guestCall(["threads", "get"], {}) as { run: { status: string; error: string } | null };
    expect(snapshot.run).toMatchObject({ status: "failed", error: expect.any(String) });
    api.chat.mockResolvedValue({ status: "completed", content: "Ya está", remaining: 11 });
    await rpc.guestCall(["threads", "retry"], { botId: "guest-mico", runId });
    await events(rpc, event => event.type === "run.completed", failed.at(-1)!.seq);
    const keys = api.chat.mock.calls.map(call => call[0].key);
    expect(new Set(keys).size).toBe(1);
  });

  it("asks again for an answer that was on its way when the page unloaded", async () => {
    const pending = { key: "11111111-2222-4333-8444-555555555555", messages: [{ role: "user" as const, content: "¿Sigues ahí?" }] };
    const { guestCache } = await import("./guest-chat");
    guestCache.save(pending.messages, pending);
    const { rpc } = await load();
    api.chat.mockResolvedValue({ status: "completed", content: "Sí, aquí sigo", remaining: 11 });
    const seen = await events(rpc, event => event.type === "run.completed", 1);
    expect(seen.map(event => event.type)).toContain("run.started");
    expect(api.chat.mock.calls[0]![0].key).toBe(pending.key);
    expect(JSON.parse(sessionStorage.getItem("mycellios:guest:chat")!).pending).toBeNull();
  });

  it("renews an expired guest session once without showing an error", async () => {
    const { rpc, chat } = await load();
    api.status.mockResolvedValue(null);
    api.enter.mockResolvedValue({ remaining: 12, limit: 12, expiresAt: Date.now() + 3_600_000 });
    api.chat.mockRejectedValueOnce(new chat.GuestChatRequestError("guest_session_expired"))
      .mockResolvedValueOnce({ status: "completed", content: "Hola de nuevo", remaining: 11 });
    await rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Hola" });
    const seen = await events(rpc, event => event.type === "run.completed" || event.type === "run.failed");
    expect(seen.at(-1)!.type).toBe("run.completed");
    expect(api.enter).toHaveBeenCalledTimes(2);
  });

  it("refuses a second message while Mico is answering and after the free messages run out", async () => {
    const { rpc, mode } = await load();
    let finish!: () => void;
    api.chat.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ status: "completed", content: "Hola", remaining: 0 }); }));
    await rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Uno" });
    await expect(rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Dos" })).rejects.toThrow();
    await vi.waitFor(() => expect(api.chat).toHaveBeenCalled());
    finish();
    await events(rpc, event => event.type === "run.completed");
    const prompts = vi.fn();
    mode.onGuestAccountPrompt(prompts);
    await expect(rpc.guestCall(["threads", "send"], { botId: "guest-mico", text: "Tres" })).rejects.toThrow();
    expect(prompts).toHaveBeenCalledWith("messages");
  });
});
