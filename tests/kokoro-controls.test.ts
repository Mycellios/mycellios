import { describe, expect, it } from "vitest";
import { KOKORO_MODEL, resolveSpeechOptions, verifiedSpeechEnvelope } from "../src/contracts/speech.js";
import { chatCompletionRequestSchema } from "../src/contracts/schemas.js";
import { inputHashForRequest } from "../src/core/request.js";
import { speechReply } from "./kokoro-fixture.js";

const base = { model: KOKORO_MODEL, messages: [{ role: "user" as const, content: "Hello" }] };
describe("bilingual speech request contract", () => {
  it("defaults to English and chooses matching default voices", () => {
    expect(resolveSpeechOptions({})).toEqual({ language: "en", voice: "af_heart", speed: 1 });
    expect(resolveSpeechOptions({ language: "es" })).toEqual({ language: "es", voice: "ef_dora", speed: 1 });
    expect(chatCompletionRequestSchema.parse({ ...base, language: "es", voice: "em_alex", speed: 1.2 })).toMatchObject({ language: "es", voice: "em_alex", speed: 1.2 });
  });
  it("rejects unsupported languages, voices, mismatches, speeds and non-speech use", () => {
    for (const controls of [{ language: "fr" }, { voice: "../../voice" }, { voice: "ef_dora" }, { language: "es", voice: "am_michael" }, { speed: 0.49 }, { speed: 2.01 }, { speed: NaN }, { speed: "1" }]) {
      expect(chatCompletionRequestSchema.safeParse({ ...base, ...controls }).success).toBe(false);
    }
    expect(chatCompletionRequestSchema.safeParse({ ...base, model: "text-model", speed: 1 }).success).toBe(false);
  });
  it("includes resolved speech controls in request identity", () => {
    expect(inputHashForRequest(base)).toBe(inputHashForRequest({ ...base, language: "en", voice: "af_heart", speed: 1 }));
    for (const controls of [{ language: "es" as const }, { voice: "am_michael" as const }, { speed: 1.2 }]) {
      expect(inputHashForRequest({ ...base, ...controls })).not.toBe(inputHashForRequest(base));
    }
  });
  it("rejects audio returned for different requested controls", () => {
    const result = speechReply();
    expect(() => verifiedSpeechEnvelope(result.content, "Hola", resolveSpeechOptions({}))).not.toThrow();
    expect(() => verifiedSpeechEnvelope(result.content, "Hola", resolveSpeechOptions({ language: "es" }))).toThrow("options_mismatch");
    expect(() => verifiedSpeechEnvelope(result.content, "Hola", resolveSpeechOptions({ speed: 1.2 }))).toThrow("options_mismatch");
  });
});
