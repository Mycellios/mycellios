import { vi } from "vitest";
export const gatewayKey = "antseed_fixture_gateway_key_not_a_real_secret_123";
export const gatewaySeller = "a".repeat(40);
export const gatewayModel = "mycellios/managed/antseed/deepseek-v4-flash";
export function antseedGatewayFixture() {
  const model = {id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", type: "text", peers: [{
    peerId: gatewaySeller, effectiveReputationScore: 50, provider: "openai", serviceId: "deepseek-v4-flash", type: "text", protocols: ["openai-chat-completions"],
    inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.02, outputUsdPerMillion: 0.2,
    capabilities: {inputs: ["text"], outputs: ["text"], contextWindow: 131072, maxOutputTokens: 8192},
  }]};
  let nonce: string | undefined, pending = false, fail = false, duplicates = false, authId = "key-fixture";
  const tag = "gw_" + "12345678-1234-1234-1234-123456789012";
  const row: Record<string, any> = {tag, keyId: authId, model: "deepseek-v4-flash", sellerPeerId: gatewaySeller,
    method: "POST", path: "/v1/chat/completions", finishedAt: Date.now(), status: 200,
    inputTokens: 3, cachedInputTokens: 1, outputTokens: 2, spent: "0.000005"};
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url)), headers = new Headers(init?.headers);
    if (u.pathname === "/console/api/auth/api-key") {
      if (JSON.parse(String(init?.body)).key !== gatewayKey || headers.get("x-antseed-console") !== "1") return new Response(null, {status: 401});
      return Response.json({kind: "key", me: {key: {id: authId}}}, {headers: {"set-cookie": "antseed_session=fixturecookie; HttpOnly; Path=/console"}});
    }
    if (u.pathname === "/console/api/requests") {
      if (headers.get("cookie") !== "antseed_session=fixturecookie") return new Response(null, {status: 401});
      const rows = nonce && u.searchParams.get("q") === nonce ? [{...row, endUser: nonce, ...(pending ? {costPending: true} : {})}] : [];
      return Response.json({requests: duplicates ? [...rows, ...rows] : rows, nextBefore: null});
    }
    if (headers.get("authorization") !== "Bearer " + gatewayKey) return new Response(null, {status: 401});
    if (u.pathname === "/v1/models") return Response.json({data: [model]});
    if (u.pathname !== "/v1/chat/completions" || init?.method !== "POST") throw new Error("unexpected fixture request");
    nonce = headers.get("x-antseed-end-user")!;
    if (fail) throw new Error("connection lost after submission");
    const usage = {prompt_tokens: 4, completion_tokens: 2, total_tokens: 6};
    const responseHeaders = {"x-antseed-gateway-tag": tag, "x-antseed-peer-id": gatewaySeller};
    if (JSON.parse(String(init.body)).stream) return new Response([
      {id: "chat-fixture", choices: [{index: 0, delta: {content: "Hi"}, finish_reason: null}]},
      {id: "chat-fixture", choices: [{index: 0, delta: {}, finish_reason: "stop"}]},
      {id: "chat-fixture", choices: [], usage},
    ].map(v => `data: ${JSON.stringify(v)}\n\n`).join("") + "data: [DONE]\n\n",
    {headers: {...responseHeaders, "content-type": "text/event-stream"}});
    return Response.json({id: "chat-fixture", choices: [{index: 0, message: {role: "assistant", content: "Hi"}, finish_reason: "stop"}], usage}, {headers: responseHeaders});
  });
  return {model, row, transport, pending: (v: boolean) => {pending = v;}, fail: () => {fail = true;},
    duplicates: () => {duplicates = true;}, changeKey: () => {authId = "another-key";},
    inference: () => transport.mock.calls.filter(([u, init]) => new URL(String(u)).pathname === "/v1/chat/completions" && init?.method === "POST")};
}
