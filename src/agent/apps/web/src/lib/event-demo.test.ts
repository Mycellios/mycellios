// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { demoApi, demoCache, eventDemoRoute } from "./event-demo";
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
it("keeps guest and presenter routes outside the signed-in app without broad path matching", () => {
  expect(eventDemoRoute("/demo/test-only-event")).toEqual({ id: "test-only-event", presenter: false });
  expect(eventDemoRoute("/demo/test-only-event/present")).toEqual({ id: "test-only-event", presenter: true });
  for (const path of ["/app/test", "/demo/test-only-event/private", "/demo/x", "/demo/test-only-event/present/admin"])
    expect(eventDemoRoute(path)).toBeNull();
});
it("enrolls idempotently, uses cookies only on same origin and never forwards an account or supplier key", async () => {
  const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ guest: { number: 1 } })); vi.stubGlobal("fetch", fetcher);
  const api = demoApi("test-only-event"); await api.enter(); await api.enter();
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: "same-origin", redirect: "error", method: "POST" });
  expect(fetcher.mock.calls[0]![1]!.body).toEqual(fetcher.mock.calls[1]![1]!.body);
  expect(Object.keys(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)))).toEqual(["nonce"]);
});
it("isolates saved transcripts by event and rejects malformed cached text", () => {
  const messages = [{ role: "user" as const, content: "Private test-only text" }];
  demoCache("test-only-one").save(messages, null);
  expect(demoCache("test-only-one").load().messages).toEqual(messages);
  expect(demoCache("test-only-two").load().messages).toEqual([]);
  sessionStorage.setItem("mycellios:demo:test-only-one:chat", JSON.stringify({ messages: [{ role: "system", content: "bad" }] }));
  expect(demoCache("test-only-one").load().messages).toEqual([]);
});
it("streams the normal provider chunks and final settled response without any automatic paid retry", async () => {
  const result = { status: "completed", response: { choices: [{ message: { content: "Hola" } }] } };
  const body = ': heartbeat\n\ndata: {"type":"delta","chunk":{"choices":[{"delta":{"content":"Ho"}}]}}\n\n'
    + 'data: {"type":"delta","chunk":{"choices":[{"delta":{"content":"la"}}]}}\n\n'
    + "data: " + JSON.stringify({ type: "result", result }) + "\n\n";
  const fetcher = vi.fn(async () => new Response(body)); vi.stubGlobal("fetch", fetcher); const chunks: string[] = [];
  expect(await demoApi("test-only-event").chat({ key: "test-only-key", messages: [{ role: "user", content: "Test" }] },
    value => chunks.push(value), new AbortController().signal)).toEqual(result);
  expect(chunks).toEqual(["Ho", "Hola"]); expect(fetcher).toHaveBeenCalledOnce();
});
it("never automatically resubmits after a dropped or unconfirmed stream", async () => {
  const fetcher = vi.fn(async () => new Response(': incomplete\n\n')); vi.stubGlobal("fetch", fetcher);
  await expect(demoApi("test-only-event").chat({ key: "test-only-key", messages: [{ role: "user", content: "Test" }] },
    () => {}, new AbortController().signal)).rejects.toThrow("demo_request_unconfirmed");
  expect(fetcher).toHaveBeenCalledOnce();
});
