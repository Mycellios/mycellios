import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { renderNetworkSpeech } from "./mycellios-network-speech.js";

const text = "Hola, esta es una prueba.";

function audio() {
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  return wav;
}

function speech(wav: Buffer, sha256 = createHash("sha256").update(wav).digest("hex")) {
  return {
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify({
        schema: "mycellios-speech/1",
        text,
        language: "es",
        voice: "ef_dora",
        speed: 1,
        audio: { format: "wav", sample_rate: 24000, duration_seconds: 4 / 48000, sha256, data: wav.toString("base64") },
      }) },
    }],
  };
}

it("uses the canonical network endpoint, explicit credit funding and verified WAV audio", async () => {
  const wav = audio();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(speech(wav)));
  await expect(renderNetworkSpeech("test-key", { text, language: "es" }, fetcher))
    .resolves.toEqual({ bytes: wav, mimeType: "audio/wav" });
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://www.mycellios.com/v1/chat/completions");
  expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).get("x-mycellios-funding")).toBe("contribution-credits");
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: "mycellios-kokoro-es",
    messages: [{ role: "user", content: text }],
    language: "es",
    voice: "ef_dora",
    stream: false,
  });
});

it("rejects invalid speech bytes and reports insufficient credits without retrying", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(speech(audio(), "0".repeat(64))))
    .mockResolvedValueOnce(new Response("provider details", { status: 402 }));
  await expect(renderNetworkSpeech("test-key", { text, language: "es" }, fetcher))
    .rejects.toMatchObject({ code: "BAD_GATEWAY" });
  await expect(renderNetworkSpeech("test-key", { text, language: "es" }, fetcher))
    .rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
