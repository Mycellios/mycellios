import { describe, expect, it } from "vitest";
import { isOpenAiCompatibleProvider } from "./domain.js";
import {
  compatibleConnectionName,
  isMycelliosBaseUrl,
  isOllamaCloudBaseUrl,
  normalizeOpenAiCompatibleBaseUrl,
  OLLAMA_CLOUD_BASE_URL,
  openAiCompatibleConnectReady,
  savedCompatibleEndpointMatches,
} from "./openai-compatible-ui.js";
import { productBrand } from "./product-brand.js";

it("requires an AntSeed key without identifying arbitrary gateways by hostname", () => {
  expect(isOpenAiCompatibleProvider("antseed")).toBe(true);
  expect(isOpenAiCompatibleProvider("other")).toBe(false);
  const input = {
    baseUrl: "https://gateway.example.test/v1",
    modelId: "peer@model",
    requiresKey: true,
  };
  expect(openAiCompatibleConnectReady(input)).toBe(false);
  expect(openAiCompatibleConnectReady({ ...input, apiKey: "antseed_fixture_key" })).toBe(true);
});

describe("Mycellios connection preset", () => {
  it("requires the account key without changing keyless local connections", () => {
    expect(isMycelliosBaseUrl(productBrand.apiBaseUrl)).toBe(true);
    expect(compatibleConnectionName(productBrand.apiBaseUrl, "Other")).toBe("Mycellios");
    const model = { baseUrl: productBrand.apiBaseUrl, modelId: "example-model" };
    expect(openAiCompatibleConnectReady(model)).toBe(false);
    expect(openAiCompatibleConnectReady({ ...model, apiKey: "example-key" })).toBe(true);
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://localhost:8000/v1",
        modelId: "example-model",
      }),
    ).toBe(true);
  });

  it.each([
    "http://www.mycellios.com/v1",
    "https://www.mycellios.com.other.test/v1",
    "https://user:password@www.mycellios.com/v1",
    "https://www.mycellios.com:8443/v1",
    "https://www.mycellios.com/v1?redirect=other",
    "https://www.mycellios.com/v1#other",
    "https://www.mycellios.com/other/v1",
  ])("does not present a different endpoint as the Mycellios preset: %s", (url) => {
    expect(isMycelliosBaseUrl(url)).toBe(false);
    expect(compatibleConnectionName(url, "Other")).toBe("Other");
  });
});

describe("openAiCompatibleConnectReady", () => {
  it("allows a new connection with base URL and explicit model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "qwen",
      }),
    ).toBe(true);
  });

  it("rejects empty base URL or model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "  ",
        modelId: "qwen",
      }),
    ).toBe(false);
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "",
      }),
    ).toBe(false);
  });
});

describe("normalizeOpenAiCompatibleBaseUrl", () => {
  it("drops trailing slashes and adds /v1 only when no version is present", () => {
    expect(normalizeOpenAiCompatibleBaseUrl(" http://127.0.0.1:8000/ ")).toBe(
      "http://127.0.0.1:8000/v1",
    );
    expect(normalizeOpenAiCompatibleBaseUrl("https://open.bigmodel.cn/api/paas/v4/")).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
  });

  it("rejects text that is not an HTTP(S) URL", () => {
    expect(() => normalizeOpenAiCompatibleBaseUrl("127.0.0.1:8000")).toThrow();
  });
});

it("uses an ordinary compatible connection for the Ollama preset and requires its key", () => {
  expect(OLLAMA_CLOUD_BASE_URL).toBe("https://ollama.com/v1");
  expect(compatibleConnectionName(OLLAMA_CLOUD_BASE_URL, "OpenAI-compatible")).toBe("Ollama Cloud");
  expect(compatibleConnectionName("https://other.test/v1", "OpenAI-compatible")).toBe(
    "OpenAI-compatible",
  );
  const input = { baseUrl: OLLAMA_CLOUD_BASE_URL, modelId: "example-model" };
  expect(openAiCompatibleConnectReady(input)).toBe(false);
  expect(openAiCompatibleConnectReady({ ...input, apiKey: "fake-key" })).toBe(true);
});

it.each([
  "https://ollama.com",
  "https://ollama.com/",
  "https://ollama.com/v1/",
  " HTTPS://OLLAMA.COM:443/?q=x ",
])("recognizes normalized Ollama URL %s", (url) => {
  expect(isOllamaCloudBaseUrl(url)).toBe(true);
});
it.each([
  undefined,
  "invalid",
  "https://ollama.com.evil.test",
  "https://ollama.com/v2",
  "http://ollama.com",
  "https://user:pass@ollama.com",
])("rejects non-preset URL %s", (url) => {
  expect(isOllamaCloudBaseUrl(url)).toBe(false);
});

it.each(["https://ollama.com", "https://ollama.com/v1/"])(
  "matches equivalent saved endpoints: %s",
  (baseUrl) => {
    expect(savedCompatibleEndpointMatches(baseUrl, OLLAMA_CLOUD_BASE_URL)).toBe(true);
  },
);
it.each(["", "https://", "https://other.test", "https://ollama.com/v2"])(
  "does not inherit credentials for %s",
  (baseUrl) => {
    expect(savedCompatibleEndpointMatches(baseUrl, OLLAMA_CLOUD_BASE_URL)).toBe(false);
  },
);
it("does not match a missing saved endpoint", () => {
  expect(savedCompatibleEndpointMatches(OLLAMA_CLOUD_BASE_URL, undefined)).toBe(false);
});
