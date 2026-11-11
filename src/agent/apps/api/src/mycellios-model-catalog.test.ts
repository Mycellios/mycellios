import { describe, expect, it, vi } from "vitest";
import { readMycelliosChatModels } from "./mycellios-model-catalog.js";

describe("Mycellios account chat catalog", () => {
  it("lists live chat models under Credit funding without inference or credential creation", async () => {
    const transport = vi.fn(async () =>
      Response.json({
        data: [
          { id: "qwen3-8b", name: "Qwen3 8B", recommended: true, x_replicas: 0, x_pipelines: 1 },
          { id: "qwen3-8b" },
          { id: "qwen3-14b", available: false },
          { id: "qwen3-32b", creditEligible: false },
          { id: "qwen3-4b", x_replicas: 0, x_pipelines: 0 },
          { id: "qwen3-embedding-4b" },
          { id: "kokoro" },
            { id: "mycellios-whisper-small", task: "transcription" },
          { id: "ltx-video" },
          { id: "unrelated", task: "speech" },
        ],
      }),
    );
    const result = await readMycelliosChatModels("account-key", {
      fetch: transport,
      credentialId: "owned",
    });
    expect(result).toEqual([
      {
        provider: "openai-compatible",
        providerName: "Mycellios",
        id: "qwen3-8b",
        label: "Qwen3 8B",
        live: true,
        billing: "Uses your Mycellios credits",
        recommended: true,
        credentialIds: ["owned"],
      },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://www.mycellios.com/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(new Headers(init.headers).get("x-mycellios-funding")).toBe("contribution-credits");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer account-key");
  });
  it.each([401, 403, 429, 503])("fails closed for an unavailable catalog (%s)", async (status) => {
    await expect(
      readMycelliosChatModels("private", {
        fetch: vi.fn(async () => new Response("private upstream", { status })),
      }),
    ).rejects.toThrow("temporarily unavailable");
  });
  it("accepts an empty catalog without inventing a default", async () => {
    expect(
      await readMycelliosChatModels("key", {
        fetch: vi.fn(async () => Response.json({ data: [] })),
      }),
    ).toEqual([]);
  });
});
