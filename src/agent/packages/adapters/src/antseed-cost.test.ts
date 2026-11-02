import { afterEach, describe, expect, it, vi } from "vitest";
import { antseedCostObserver, antseedReceiptCost, readAntSeedCost } from "./antseed-cost.js";

afterEach(() => vi.unstubAllEnvs());
const receipt = (extra: Record<string, unknown> = {}) => ({
  tag: "gw-fixture",
  endUser: "call-fixture",
  finishedAt: 1,
  spent: "0.000123",
  ...extra,
});
describe("AntSeed exact request billing", () => {
  it("sums charged receipts, deduplicates retries and excludes other calls", () =>
    expect(
      antseedReceiptCost(
        [
          receipt(),
          receipt(),
          receipt({ tag: "retry", spent: "0.000007" }),
          receipt({ tag: "other", endUser: "other", spent: "99" }),
        ],
        "call-fixture",
      ),
    ).toMatchObject({ state: "confirmed", costUsd: 0.00013 }));
  it("distinguishes served-free, pending and not recorded", () => {
    expect(
      antseedReceiptCost([receipt({ spent: null, servedFree: true })], "call-fixture").costUsd,
    ).toBe(0);
    expect(
      antseedReceiptCost([receipt({ spent: null, costPending: true })], "call-fixture"),
    ).toMatchObject({ state: "pending", costUsd: null });
    expect(antseedReceiptCost([receipt({ spent: null })], "call-fixture")).toMatchObject({
      state: "unavailable",
      costUsd: null,
    });
    expect(
      antseedReceiptCost([receipt({ finishedAt: null, spent: "0" })], "call-fixture").costUsd,
    ).toBeNull();
  });
  it.each(["-1", "NaN", "Infinity", "0.0000001", 1])("rejects malformed settlement %s", (spent) =>
    expect(antseedReceiptCost([receipt({ spent })], "call-fixture").costUsd).toBeNull(),
  );
  it("does not invent zero for a missing receipt", () =>
    expect(antseedReceiptCost([], "call-fixture").costUsd).toBeNull());
  it("uses the gateway free-pricing headers and an opaque per-call attribution", async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("x-antseed-end-user")).toBe("call-fixture");
      return new Response("ok", {
        headers: {
          "x-antseed-input-usd-per-million": "0",
          "x-antseed-output-usd-per-million": "0",
        },
      });
    });
    const observer = antseedCostObserver(transport, "call-fixture");
    await observer.fetch("https://gateway.example.test/v1/chat/completions", {
      headers: { authorization: "Bearer fixture-key" },
    });
    expect(await observer.cost()).toMatchObject({ costUsd: 0, state: "confirmed" });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("reads scoped receipts through the same key, preserving URL guards", async () => {
    vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      const target = new URL(String(url));
      expect(init?.redirect).toBe("error");
      if (target.pathname.endsWith("/auth/api-key")) {
        expect(JSON.parse(String(init?.body))).toEqual({ key: "fixture-key-scope" });
        return Response.json(
          {},
          { headers: { "set-cookie": "antseed_session=fixture-cookie; HttpOnly; Path=/console" } },
        );
      }
      expect(target.searchParams.get("q")).toBe("call-fixture");
      expect(new Headers(init?.headers).get("cookie")).toBe("antseed_session=fixture-cookie");
      return Response.json({ requests: [receipt()] });
    });
    expect(
      await readAntSeedCost({
        baseUrl: "https://billing.example.test/v1",
        apiKey: "fixture-key-scope",
        callId: "call-fixture",
        fetch: transport,
      }),
    ).toMatchObject({ costUsd: 0.000123, state: "confirmed" });
    const blocked = vi.fn<typeof fetch>();
    expect(
      (
        await readAntSeedCost({
          baseUrl: "http://127.0.0.1:1234/v1",
          apiKey: "fixture-key-private",
          callId: "call-fixture",
          fetch: blocked,
        })
      ).costUsd,
    ).toBeNull();
    expect(blocked).not.toHaveBeenCalled();
  });
  it("leaves cost unknown on receipt/auth failures", async () => {
    vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
    expect(
      await readAntSeedCost({
        baseUrl: "https://refused.example.test/v1",
        apiKey: "fixture-key-refused",
        callId: "call-fixture",
        fetch: async () => new Response("", { status: 401 }),
      }),
    ).toMatchObject({ costUsd: null, state: "unavailable" });
  });
  it("does not send a console key over public HTTP", async () => {
    vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
    const fetcher = vi.fn<typeof fetch>();
    expect(
      (
        await readAntSeedCost({
          baseUrl: "http://public.example.test/v1",
          apiKey: "fixture-key-http",
          callId: "call-fixture",
          fetch: fetcher,
        })
      ).costUsd,
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not hide a paid attempt when a later HTTP retry was free", async () => {
    vi.stubEnv("RAKAZO_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
    let calls = 0;
    const fetcher: typeof fetch = async (url) => {
      const target = new URL(String(url));
      if (target.pathname.endsWith("/chat/completions")) {
        calls++;
        return new Response("ok", {
          headers:
            calls === 2
              ? { "x-antseed-input-usd-per-million": "0", "x-antseed-output-usd-per-million": "0" }
              : {},
        });
      }
      if (target.pathname.endsWith("/auth/api-key"))
        return Response.json(
          {},
          { headers: { "set-cookie": "session=retry-fixture; Path=/console" } },
        );
      return Response.json({
        requests: [receipt(), receipt({ tag: "gw-free", spent: null, servedFree: true })],
      });
    };
    const observer = antseedCostObserver(fetcher, "call-fixture");
    for (let i = 0; i < 2; i++)
      await observer.fetch("https://retry.example.test/v1/chat/completions", {
        headers: { authorization: "Bearer fixture-key-retry" },
      });
    expect(await observer.cost()).toMatchObject({ state: "confirmed", costUsd: 0.000123 });
  });
});
