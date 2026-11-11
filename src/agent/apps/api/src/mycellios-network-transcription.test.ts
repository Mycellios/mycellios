import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { renderNetworkTranscription } from "./mycellios-network-transcription.js";

function audio() {
  const a = Buffer.alloc(364); a.write("RIFF"); a.writeUInt32LE(a.length - 8, 4); a.write("WAVEfmt ", 8);
  a.writeUInt32LE(16, 16); a.writeUInt16LE(1, 20); a.writeUInt16LE(1, 22); a.writeUInt32LE(16000, 24);
  a.writeUInt32LE(32000, 28); a.writeUInt16LE(2, 32); a.writeUInt16LE(16, 34); a.write("data", 36); a.writeUInt32LE(a.length - 44, 40);
  return a;
}
const pin = ["approved-asr-node"];
it("uses the real network, explicit contribution funding and approved placement without retries", async () => {
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("mycellios-whisper-small");
    expect(new Headers(init?.headers).get("x-mycellios-funding")).toBe("contribution-credits");
    expect(body.privacy).toEqual({ trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: pin });
    const request = JSON.parse(body.messages[0].content);
    expect(request.audio.sha256).toBe(createHash("sha256").update(audio()).digest("hex"));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      schema: "mycellios-transcription/1", model: body.model, audio_sha256: request.audio.sha256,
      language: "es", requested_language: "es", text: "Buenos días.", usage: { input_tokens: 4, output_tokens: 0, tokenizer: "cl100k_base" },
    }) } }] });
  });
  expect(await renderNetworkTranscription("private-key", { audio: audio(), language: "es", workerIdentityIds: pin }, transport)).toEqual({ text: "Buenos días." });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("refuses missing placement and invalid audio before spending credits", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(renderNetworkTranscription("key", { audio: audio() }, transport)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  await expect(renderNetworkTranscription("key", { audio: Buffer.from("webm"), workerIdentityIds: pin }, transport)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(transport).not.toHaveBeenCalled();
});
it.each([{ status: 402, code: "PAYMENT_REQUIRED" }, { status: 401, code: "FORBIDDEN" }, { status: 403, code: "FORBIDDEN" }, { status: 429, code: "TOO_MANY_REQUESTS" }, { status: 503, code: "SERVICE_UNAVAILABLE" }])("does not switch funding or repeat a paid request after $status", async ({ status, code }) => {
  const transport = vi.fn<typeof fetch>(async () => new Response("", { status }));
  await expect(renderNetworkTranscription("key", { audio: audio(), workerIdentityIds: pin }, transport)).rejects.toMatchObject({ code });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("rejects an unrelated or truncated transcription", async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "another clip" } }] }));
  await expect(renderNetworkTranscription("key", { audio: audio(), workerIdentityIds: pin }, transport)).rejects.toMatchObject({ code: "BAD_GATEWAY" });
});
