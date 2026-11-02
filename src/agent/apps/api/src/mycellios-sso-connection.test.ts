import { describe, expect, it, vi } from "vitest";
import {
  MycelliosConnectionUnavailable,
  provisionMycelliosConnection,
} from "./mycellios-sso-connection.js";

const key = "private-fixture-key-with-enough-bytes";
function transportFixture(failModels = false, funding = true) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe("https://www.mycellios.com");
    expect(init?.redirect).toBe("error");
    if (url.pathname === "/v1/api-keys") {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-session");
      return Response.json({ id: "key-1", secret: key });
    }
    if (url.pathname === "/v1/api-keys/key-1") return new Response(null, { status: 204 });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    if (url.pathname === "/v1/account/economy")
      return Response.json({
        object: "economic_account",
        asset: "MYC_MICROCREDITS",
        balanceMicrounits: 0,
        lifetimeMicrounits: 0,
        settledJobs: 0,
        contributionFundingSupported: funding,
      });
    if (failModels) return new Response("private diagnostics", { status: 503 });
    return Response.json({ object: "list", data: [{ id: "available-model", object: "model" }] });
  });
}
describe("Mycellios SSO model connection", () => {
  it("allows bounded public-authority round trips without expiring the full setup at twenty seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    try {
      const fixture = transportFixture();
      const transport: typeof fetch = async (input, init) => {
        if (String(input).endsWith("/api-keys")) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 21_000);
            init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
          });
        }
        return fixture(input, init);
      };
      const result = provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      await vi.advanceTimersByTimeAsync(21_001);
      expect(await result).toMatchObject({ ok: true, value: { modelId: "available-model" } });
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });

  it("still aborts a stalled first-party setup after sixty seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    try {
      const transport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
      const result = provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }).then(() => false, error => error);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await result).toBeInstanceOf(MycelliosConnectionUnavailable);
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it("uses an available chat model when the deployment default is no longer listed", async () => {
    const transport = transportFixture();
    const result = await provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "retired-model" });
    expect(result.modelId).toBe("available-model");
  });

  it("reuses the existing account key, capabilities and limits without rotation", async () => {
    const transport = transportFixture();
    const existing = { kind: "openai_compatible" as const, baseUrl: "https://www.mycellios.com/v1", apiKey: key, maxTokens: 2048, contextWindow: 32768, enabledModelIds: ["available-model"], headers: { "x-custom": "retained" } };
    const result = await provisionMycelliosConnection("fixture-session", { fetch: transport, existing });
    expect(result.connection).toMatchObject({ ...existing, headers: { "x-custom": "retained", "x-mycellios-funding": "contribution-credits" } });
    await result.revoke();
    expect(transport.mock.calls.every(([url]) => !String(url).includes("/api-keys"))).toBe(true);
  });

  it("does not trust a stored funding header when the authority no longer supports Credits", async () => {
    const transport = transportFixture(false, false);
    await expect(provisionMycelliosConnection("fixture-session", { fetch: transport, existing: { kind: "openai_compatible", baseUrl: "https://www.mycellios.com/v1", apiKey: key, headers: { "x-mycellios-funding": "contribution-credits" } } })).rejects.toThrow(MycelliosConnectionUnavailable);
    expect(transport.mock.calls.every(([url]) => !String(url).includes("/api-keys"))).toBe(true);
  });

  it("does not silently switch SSO connections to operator-funded inference", async () => {
    const transport = transportFixture(false, false);
    await expect(
      provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }),
    ).rejects.toThrow(MycelliosConnectionUnavailable);
    expect(
      transport.mock.calls.some(
        ([url, init]) => String(url).endsWith("/api-keys/key-1") && init?.method === "DELETE",
      ),
    ).toBe(true);
  });
  it("creates an owned key and enables explicit native credit funding without spending", async () => {
    const transport = transportFixture();
    const result = await provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" });
    expect(result.modelId).toBe("available-model");
    expect(result.connection.headers).toEqual({ "x-mycellios-funding": "contribution-credits" });
    expect(transport.mock.calls.some(([url]) => String(url).includes("chat/completions"))).toBe(
      false,
    );
  });
  it("revokes its newly created key if model discovery fails and hides diagnostics", async () => {
    const transport = transportFixture(true);
    await expect(
      provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }),
    ).rejects.toThrow(MycelliosConnectionUnavailable);
    expect(
      transport.mock.calls.some(
        ([url, init]) => String(url).endsWith("/api-keys/key-1") && init?.method === "DELETE",
      ),
    ).toBe(true);
  });
  it("does not follow redirects carrying the sign-in token", async () => {
    const transport = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://example.test" } }),
    );
    await expect(
      provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }),
    ).rejects.toThrow(MycelliosConnectionUnavailable);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500, 503])(
    "fails closed when the account service returns %s",
    async (status) => {
      const transport = vi.fn(async () => new Response("private upstream diagnostics", { status }));
      await expect(
        provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }),
      ).rejects.toMatchObject({
        name: "MycelliosConnectionUnavailable",
        message: "Mycellios account access is temporarily unavailable. No credits were spent.",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("does not expose credentials when the transport fails", async () => {
    const transport = vi.fn(async () => {
      throw new Error("private bearer fixture-session");
    });
    await expect(
      provisionMycelliosConnection("fixture-session", { fetch: transport, modelId: "available-model" }),
    ).rejects.toMatchObject({
      message: "Mycellios account access is temporarily unavailable. No credits were spent.",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
