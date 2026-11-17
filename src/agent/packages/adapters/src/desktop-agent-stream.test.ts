import { afterEach, expect, it, vi } from "vitest";
import { createLogger, createTestSink, installLogger } from "@rakazo/logging";
import { desktopLegacyFailureCode, parseDesktopDiagnostic } from "@rakazo/contracts";
import { desktopAgentFrames } from "./desktop-agent-stream.js";
const id = "12345678-1234-4321-8765-123456789abc";
const collect = async (response: Response, signal = new AbortController().signal) => {
  const values: unknown[] = [];
  for await (const v of desktopAgentFrames(response, signal, "callback")) values.push(v);
  return values;
};
afterEach(() => vi.restoreAllMocks());
it.each([
  "Desktop disconnected. Check results before retrying.",
  "Local computer access was revoked.",
  "Project access was revoked.",
  "Desktop command timed out. Check results before retrying.",
  "Desktop response disconnected. Check results before retrying.",
  "Desktop result exceeded its buffer",
  "Desktop relay restarted. Check results before retrying.",
])("retains the broker cause and operation for %s", async (error) => {
  const response = new Response(JSON.stringify({ error }) + "\n", {
    headers: { "x-mycellios-desktop-operation": id },
  });
  const failure = await collect(response).catch((e) => e as Error);
  expect(parseDesktopDiagnostic(failure.message)).toEqual({
    code: desktopLegacyFailureCode(error),
    phase: "callback",
    stage: "native_stream",
    operationId: id,
  });
});
it("retains the native stage without trusting an error's text or forged operation ID", async () => {
  const sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  const failure = await collect(
    new Response(
      JSON.stringify({
        error: "password=private-secret https://private.test",
        code: "native_transport_interrupted",
        stage: "result_ack",
        operationId: "private-secret",
      }) + "\n",
      { headers: { "x-mycellios-desktop-operation": id } },
    ),
  ).catch((e) => e as Error);
  expect(parseDesktopDiagnostic(failure.message)).toMatchObject({
    code: "native_transport_interrupted",
    stage: "result_ack",
    operationId: id,
  });
  expect(JSON.stringify(sink.events)).not.toContain("private-secret");
  expect(sink.events.at(-1)).toMatchObject({
    "desktop.stage": "result_ack",
    "desktop.operation.id": id,
  });
});
it("requires a terminal frame and differentiates truncation from malformed frames", async () => {
  for (const [data, code] of [
    ['{"value":1}\n', "stream_incomplete"],
    ["secret-not-json\n", "invalid_frame"],
    ["null\n", "invalid_frame"],
    ['{"done":true}\n{"value":1}\n', "invalid_frame"],
  ] as const) {
    const error = await collect(new Response(data)).catch((e) => e as Error);
    expect(parseDesktopDiagnostic(error.message)?.code).toBe(code);
  }
  await expect(collect(new Response('{"value":1}\n{"done":true}\n'))).resolves.toEqual([1]);
});
it("preserves aborted and updating semantics without inferring success or replay", async () => {
  const controller = new AbortController();
  controller.abort(new Error("user stopped"));
  await expect(collect(new Response(""), controller.signal)).rejects.toThrow("user stopped");
  await expect(
    collect(new Response('{"error":"update","code":"desktop_updating","dispatched":false}\n')),
  ).rejects.toMatchObject({ dispatched: false });
});
it("records a rejected dispatch separately from an already started run", async () => {
  const error = await collect(
    new Response(null, { status: 429, headers: { "x-mycellios-desktop-error": "desktop_busy" } }),
  ).catch((e) => e as Error);
  expect(parseDesktopDiagnostic(error.message)).toEqual({
    code: "desktop_busy",
    phase: "callback",
    stage: "dispatch",
  });
});
it("does not invent a disconnection when an upstream rejection has no known cause",async()=>{
  const error=await collect(new Response("private response",{status:503})).catch(e=>e as Error);
  expect(parseDesktopDiagnostic(error.message)).toEqual({code:"relay_stream_failure",phase:"callback",stage:"dispatch"});
  expect(error.message).not.toContain("private response");
});
