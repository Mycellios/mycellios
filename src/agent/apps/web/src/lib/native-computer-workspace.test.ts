import { expect, it, vi } from "vitest";
import { NATIVE_PROJECT_INSTRUCTIONS } from "./native-project-instructions";
import { nativeComputerAdmission, nativeComputerFetch } from "./native-computer-execution";
import { prepareNativeWorkspace } from "./native-computer-workspace";

it("keeps the authenticated Space and preserves a new agent's assignment while its introduction waits", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ json: { id: "bot", computerMode: "team", instructions: NATIVE_PROJECT_INSTRUCTIONS } }));
  await prepareNativeWorkspace(send, "https://example.test", "/agent", "space", "bot");
  expect(send.mock.calls.map(call => call[0])).toEqual(["https://example.test/agent/rpc/bots/get"]);
  const init = send.mock.calls[0]![1]!;
  expect(new Headers(init.headers).get("x-rakazo-space-id")).toBe("space");
  expect(init.credentials).toBe("include");
  expect(JSON.parse(String(init.body))).toEqual({ json: { botId: "bot" } });
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

it("preserves existing instructions with a compare-and-set update without changing the assignment", async () => {
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
it("rejects a mismatched update response without changing the shared assignment", async () => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({json:{id:"bot",computerMode:"team",instructions:"rules"}}))
    .mockResolvedValueOnce(Response.json({json:{id:"other",computerMode:"team"}}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow("did not match");
  expect(send).toHaveBeenCalledTimes(2);
});


it("sends the original draft after native admission without switching an introductory agent", async () => {
  const calls: string[] = [];
  const draft = JSON.stringify({ json: { botId: "bot", text: "original draft" } });
  const send = vi.fn<typeof fetch>(async (input, init) => {
    calls.push(String(input));
    if (String(input).endsWith("/bots/get")) return Response.json({json: {id:"bot",computerMode:"team",instructions:NATIVE_PROJECT_INSTRUCTIONS}});
    expect(String(input)).toBe("https://example.test/agent/rpc/threads/send");
    expect(init?.body).toBe(draft);
    return Response.json({json:{ok:true}});
  });
  const computer = {
    requestAccess: vi.fn(async () => true), revokeAccess: vi.fn(async () => undefined),
    connect: vi.fn(async (_id:string) => undefined), connected: vi.fn(async (_id:string) => true),
    projectAvailable: vi.fn(async () => true), onConfigure: vi.fn(() => () => undefined),
  };
  const admit = nativeComputerAdmission(computer, id => prepareNativeWorkspace(send,"https://example.test","/agent","space",id));
  const execute = nativeComputerFetch(send,computer,"https://example.test","/agent",admit);
  await execute("https://example.test/agent/rpc/threads/send",{method:"POST",body:draft});
  expect(calls).toEqual(["https://example.test/agent/rpc/bots/get","https://example.test/agent/rpc/threads/send"]);
  expect(computer.connect).toHaveBeenCalledWith("bot");
});


it.each([
  [401,"Sign in again"], [403,"This account cannot"], [409,"This agent changed"], [500,"Could not prepare this agent"],
])("keeps a status-specific actionable error without exposing response data: %s", async (status, message) => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream details",{status:Number(status)}));
  await expect(prepareNativeWorkspace(send,"https://example.test","/agent",null,"bot")).rejects.toThrow(String(message));
  expect(send).toHaveBeenCalledTimes(1);
});
