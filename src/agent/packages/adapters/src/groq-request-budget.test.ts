import { expect, it } from "vitest";
import { groqInitialRequestWindow, groqRequestContextWindow } from "./groq-request-budget.js";

it("applies the baseline only to the directly connected Groq GPT-OSS models", () => {
  expect(groqInitialRequestWindow("groq", "openai/gpt-oss-20b")).toBe(6800);
  expect(groqInitialRequestWindow("groq", "openai/gpt-oss-120b")).toBe(6800);
  expect(groqInitialRequestWindow("openrouter", "openai/gpt-oss-20b")).toBeUndefined();
  expect(groqInitialRequestWindow("groq", "other-model")).toBeUndefined();
});

it("accepts Groq's plain 413 but does not treat temporary 429s as request ceilings", () => {
  const details = "Request too large for model `openai/gpt-oss-20b` in organization `fixture` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 19074, please reduce your message size.";
  expect(groqRequestContextWindow("groq", `413: ${details}`, 131072)).toBe(6800);
  expect(groqRequestContextWindow("groq", `429: ${details}`, 131072)).toBeUndefined();
});

const error = (limit = 6000, requested = 7000) =>
  `413: ${JSON.stringify({ code: "rate_limit_exceeded", type: "tokens", message: `Request too large on tokens per minute (TPM): Limit ${limit}, Requested ${requested}, please reduce your message size.` })}`;
it("derives a smaller request window only from the token-rate rejection", () => {
  expect(groqRequestContextWindow("groq", error(), 32000)).toBe(5100);
  expect(groqRequestContextWindow("other", error(), 32000)).toBeUndefined();
  expect(groqRequestContextWindow("groq", error(), 4000)).toBeUndefined();
});
it.each([
  undefined,
  "413: invalid JSON",
  error(0),
  error(6000, 5000),
  error(Number.MAX_SAFE_INTEGER + 1),
  '413: {"code":"other","type":"tokens","message":"on tokens per minute (TPM): Limit 6000, Requested 7000,"}',
])("ignores malformed or unrelated limits", (value) => {
  expect(groqRequestContextWindow("groq", value, 32000)).toBeUndefined();
});
