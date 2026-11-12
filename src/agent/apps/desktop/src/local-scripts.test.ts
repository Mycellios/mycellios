import { afterEach, expect, it, vi } from "vitest";
import { request } from "node:http";
import type { ThreadMessage } from "@rakazo/contracts";
import { LocalScriptsHost, LocalScriptRateError, type ScriptSession } from "./local-scripts.js";

const hosts: LocalScriptsHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); });
async function fixture(files: Record<string, string> = {}) {
  let now = 10000000;
  const policy = { ownerId: "owner", spaceId: "space", revision: 0, defaults: {}, bots: [{ id: "bot", preferences: { localScripts: true } }, { id: "denied", preferences: {} }] };
  const snapshot = { threadId: "thread", cursor: 1, messages: [] as ThreadMessage[], olderCursor: null, run: null };
  const rpc = vi.fn(async (path: string) => path === "preferences/micos" ? policy : path === "threads/get" ? snapshot : path === "routines/list" ? [] : { ok: true });
  const session: ScriptSession = { binding: { server: "https://mycellios.example", owner: "owner", space: "space" }, rpc, valid: vi.fn().mockResolvedValue(true) };
  let current: ScriptSession | null = session;
  const write = vi.fn(async (kind: string, raw: string) => { files[kind] = raw; });
  const host = new LocalScriptsHost({ configPath: "private-config.json", read: async kind => files[kind] ?? null, write, session: async () => current, now: () => now });
  hosts.push(host); await host.start();
  const token = () => JSON.parse(files.config!).token as string;
  return { host, policy, snapshot, rpc, session, write, files, token, switch: (next: ScriptSession | null) => { current = next; }, advance: (ms: number) => { now += ms; } };
}
const send = { action: "send", botId: "bot", text: "hello", nonce: "one" };
function post(url: string, headers: Record<string, string>, body: string) {
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { method: "POST", headers }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end(body);
  });
}
it("requires both host opt-in and a valid local key", async () => {
  const f = await fixture(); await expect(f.host.perform(send, "bad")).rejects.toThrow();
  await f.host.configure({ enabled: true });
  await expect(f.host.perform(send, "bad")).rejects.toThrow();
  await f.host.perform(send, f.token());
  expect(f.rpc).toHaveBeenLastCalledWith("threads/send", { botId: "bot", text: "hello", delivery: "queue", clientNonce: "local:one" });
  expect(await f.host.state()).not.toHaveProperty("token");
});
it.each(["denied", "other-owner"])("blocks Mico %s without any write or send", async botId => {
  const f = await fixture(); await f.host.configure({ enabled: true }); f.write.mockClear();
  await expect(f.host.perform({ ...send, botId }, f.token())).rejects.toThrow();
  expect(f.write).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalledWith("threads/send", expect.anything());
});
it("rejects account, Space, server and cookie-owner changes", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true });
  for (const binding of [{ ...f.session.binding, owner: "other" }, { ...f.session.binding, space: "other" }, { ...f.session.binding, server: "https://other.example" }]) {
    f.switch({ ...f.session, binding }); await expect(f.host.perform(send, f.token())).rejects.toThrow();
  }
  f.switch(f.session); f.policy.ownerId = "cookie-switched"; await expect(f.host.perform(send, f.token())).rejects.toThrow();
  f.switch(null); await expect(f.host.perform(send, f.token())).rejects.toThrow();
});
it("checks live per-Mico policy, revocation and persistent rolling quota", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true, requestsPerHour: 10 });
  await Promise.all(Array.from({ length: 10 }, (_, n) => f.host.perform({ ...send, nonce: String(n) }, f.token())));
  await expect(f.host.perform(send, f.token())).rejects.toBeInstanceOf(LocalScriptRateError);
  await f.host.close(); const restarted = await fixture(f.files);
  await expect(restarted.host.perform(send, restarted.token())).rejects.toBeInstanceOf(LocalScriptRateError);
  restarted.advance(3600001); await restarted.host.perform(send, restarted.token());
  restarted.policy.bots[0]!.preferences.localScripts = false;
  await expect(restarted.host.perform(send, restarted.token())).rejects.toThrow();
  await restarted.host.configure({ enabled: false }); await expect(restarted.host.perform(send, "old-key")).rejects.toThrow();
});
it("does not send when quota cannot be persisted or session changes mid-request", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true });
  f.write.mockRejectedValueOnce(new Error("disk")); await expect(f.host.perform(send, f.token())).rejects.toThrow("disk");
  (f.session.valid as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true).mockResolvedValue(false);
  await expect(f.host.perform(send, f.token())).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalledWith("threads/send", expect.anything());
});
it("rejects cross-Mico routines and arbitrary proxy fields", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true });
  await expect(f.host.perform({ action: "routine", botId: "bot", routineId: "foreign", nonce: "one" }, f.token())).rejects.toThrow();
  await expect(f.host.perform({ ...send, url: "https://elsewhere.example" }, f.token())).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalledWith("routines/testRun", expect.anything());
});
it("answers only the selected Mico's pending question and separates one-time approval decisions", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true });
  const message: ThreadMessage = { id: "ask", threadId: "thread", seq: 1, role: "bot", botId: "bot", runId: "run", createdAt: new Date().toISOString(), blocks: [{ kind: "ask", text: "Question", status: "pending" }] };
  f.snapshot.messages.push(message);
  await f.host.perform({ action: "answer", botId: "bot", runId: "run", messageId: "ask", answer: "Answer", nonce: "answer" }, f.token());
  expect(f.rpc).toHaveBeenLastCalledWith("threads/answer", { botId: "bot", runId: "run", messageId: "ask", answer: "Answer", clientNonce: "local:answer" });
  message.blocks = [{ kind: "ask", text: "Approve?", status: "pending", approvalEffectId: "effect", actions: [{ id: "allow", label: "Allow once" }, { id: "deny", label: "Deny" }] }];
  await expect(f.host.perform({ action: "answer", botId: "bot", runId: "run", messageId: "ask", answer: "always", nonce: "bad" }, f.token())).rejects.toThrow();
  await expect(f.host.perform({ action: "approval", botId: "bot", runId: "run", messageId: "ask", decision: "always", nonce: "bad" }, f.token())).rejects.toThrow();
  await f.host.perform({ action: "approval", botId: "bot", runId: "run", messageId: "ask", decision: "deny", nonce: "deny" }, f.token());
  expect(f.rpc).toHaveBeenLastCalledWith("threads/answer", expect.objectContaining({ answer: "deny" }));
  await expect(f.host.perform({ action: "approval", botId: "bot", runId: "foreign", messageId: "ask", decision: "allow", nonce: "foreign" }, f.token())).rejects.toThrow();
  message.blocks = [{ kind: "ask", text: "Done", status: "answered" }];
  await expect(f.host.perform({ action: "answer", botId: "bot", runId: "run", messageId: "ask", answer: "late", nonce: "late" }, f.token())).rejects.toThrow();
});
it("a backwards clock and a rotated token cannot bypass quota or host revocation", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true }); const old = f.token();
  await f.host.perform(send, old); f.advance(-1);
  await expect(f.host.perform(send, old)).rejects.toBeInstanceOf(LocalScriptRateError);
  await f.host.configure({ enabled: true }); await expect(f.host.perform(send, old)).rejects.toThrow();
});
it("the real HTTP listener refuses missing keys, browser Origins, rebinding hosts and oversized requests", async () => {
  const f = await fixture(); await f.host.configure({ enabled: true }); const url = (await f.host.state()).endpoint!;
  const headers = { authorization: `Bearer ${f.token()}`, "content-type": "application/json" };
  expect(await post(url, { "content-type": "application/json" }, JSON.stringify(send))).toBe(401);
  expect(await post(url, { ...headers, origin: "https://attacker.example" }, JSON.stringify(send))).toBe(403);
  expect(await post(url, { ...headers, host: "rebind.example" }, JSON.stringify(send))).toBe(403);
  expect(await post(url, headers, " ".repeat(65537))).toBe(413);
  expect(await post(url, headers, JSON.stringify(send))).toBe(200);
});
