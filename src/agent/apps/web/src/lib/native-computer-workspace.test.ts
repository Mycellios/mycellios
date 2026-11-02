import { expect, it, vi } from "vitest";
import { NATIVE_PROJECT_INSTRUCTIONS } from "./native-project-instructions";
import { prepareNativeWorkspace } from "./native-computer-workspace";

it("keeps the authenticated Space and changes only an owned Mico's shared assignment", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ json: { id: "bot", computerMode: "team", instructions: NATIVE_PROJECT_INSTRUCTIONS } }))
    .mockResolvedValueOnce(Response.json({ json: { id: "bot", computerMode: "dedicated", instructions: NATIVE_PROJECT_INSTRUCTIONS } }));
  await prepareNativeWorkspace(send, "https://example.test", "/agent", "space", "bot");
  expect(send.mock.calls.map(call => call[0])).toEqual(["https://example.test/agent/rpc/bots/get", "https://example.test/agent/rpc/bots/setComputer"]);
  const init = send.mock.calls[1]![1]!;
  expect(new Headers(init.headers).get("x-rakazo-space-id")).toBe("space");
  expect(init.credentials).toBe("include");
  expect(JSON.parse(String(init.body))).toEqual({ json: { botId: "bot", mode: "dedicated" } });
});
it("leaves an existing private workspace intact", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ json: { id: "bot", computerMode: "dedicated", instructions: NATIVE_PROJECT_INSTRUCTIONS } }));
  await prepareNativeWorkspace(send, "https://example.test", "/agent", null, "bot");
  expect(send).toHaveBeenCalledTimes(1);
});
it("does not change assignments after authentication fails or another Mico is returned", async () => {
  for (const response of [new Response(null, {status:401}), Response.json({json:{id:"other",computerMode:"team"}})]) {
    const send = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  }
});

it("preserves existing instructions with a compare-and-set update before assigning the workspace", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({json:{id:"bot",computerMode:"dedicated",instructions:"Existing owner rules"}}))
    .mockResolvedValueOnce(Response.json({json:{id:"bot",computerMode:"dedicated"}}));
  await prepareNativeWorkspace(send,"https://example.test","/agent","space","bot");
  const body = JSON.parse(String(send.mock.calls[1]![1]!.body)).json;
  expect(body.expectedInstructions).toBe("Existing owner rules");
  expect(body.instructions).toBe("Existing owner rules\n\n" + NATIVE_PROJECT_INSTRUCTIONS);
});
it("does not continue after a concurrent instruction edit", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({json:{id:"bot",computerMode:"team",instructions:"old"}}))
    .mockResolvedValueOnce(new Response(null,{status:409}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(2);
});
it("does not submit an update if instructions cannot be read", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({json:{id:"bot",computerMode:"dedicated"}}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});

it("never truncates owner instructions to fit the workflow", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({json:{id:"bot",computerMode:"dedicated",instructions:"x".repeat(20000)}}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow("too long");
  expect(send).toHaveBeenCalledTimes(1);
});
it("rejects a mismatched update response before assigning a shared workspace", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({json:{id:"bot",computerMode:"team",instructions:"rules"}}))
    .mockResolvedValueOnce(Response.json({json:{id:"other",computerMode:"team"}}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow("did not match");
  expect(send).toHaveBeenCalledTimes(2);
});
