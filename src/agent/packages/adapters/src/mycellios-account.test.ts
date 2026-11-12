import { describe, expect, it, vi } from "vitest";
import {
  configureMycelliosFunding,
  mycelliosAccountUrl,
  readMycelliosAccount,
  MycelliosAccountAccessError,
} from "./mycellios-account.js";

const connection = { baseUrl: "https://www.mycellios.com/v1", apiKey: "test-account-key" };
const account = {
  object: "economic_account",
  asset: "MYC_MICROCREDITS",
  balanceMicrounits: 1234567,
  lifetimeMicrounits: 2345678,
  settledJobs: 3,
};

describe("Mycellios account integration", () => {
  it.each([401, 403] as const)("preserves sanitized authority access status %s", async status => {
    const failure = await readMycelliosAccount(connection, {
      fetch: vi.fn(async () => new Response("private diagnostics test-account-key", { status })),
    }).catch(error => error);
    expect(failure).toBeInstanceOf(MycelliosAccountAccessError);
    expect(failure.status).toBe(status);
    expect(failure.message).not.toContain("test-account-key");
    expect(JSON.stringify(failure)).not.toContain("private diagnostics");
  });
  it("reads canonical contribution credits without a ledger write", async () => {
    const transport = vi.fn(async () => Response.json(account));
    await expect(readMycelliosAccount(connection, { fetch: transport })).resolves.toEqual(account);
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://www.mycellios.com/v1/account/economy");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-account-key");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.redirect).toBe("error");
  });

  it("negotiates contribution funding only with the canonical account authority", async () => {
    const transport = vi.fn(async () =>
      Response.json({
        ...account,
        contributionFundingSupported: true,
        reservedMicrounits: 1_000_000,
        availableMicrounits: 234567,
      }),
    );
    await expect(
      configureMycelliosFunding(
        { ...connection, headers: { "X-Request-Tag": "fixture" } },
        { fetch: transport },
      ),
    ).resolves.toEqual({
      ...connection,
      headers: { "x-request-tag": "fixture", "x-mycellios-funding": "contribution-credits" },
    });
    const other = { ...connection, baseUrl: "https://other.example/v1" };
    await expect(configureMycelliosFunding(other, { fetch: transport })).resolves.toBe(other);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("preserves legacy connections without claiming that MYC consumption is enabled", async () => {
    await expect(
      configureMycelliosFunding(connection, {
        fetch: vi.fn(async () => Response.json(account)),
      }),
    ).resolves.toBe(connection);
  });

  it("rejects an available balance greater than the actual balance", async () => {
    await expect(
      readMycelliosAccount(connection, {
        fetch: vi.fn(async () =>
          Response.json({ ...account, availableMicrounits: account.balanceMicrounits + 1 }),
        ),
      }),
    ).rejects.toThrow("temporarily unavailable");
  });

  it.each([
    "http://www.mycellios.com/v1",
    "https://www.mycellios.com.evil.invalid/v1",
    "https://other.invalid/v1",
    "https://www.mycellios.com:8443/v1",
    "https://user:pass@www.mycellios.com/v1",
    "https://www.mycellios.com/v1?route=other",
    "https://www.mycellios.com/public/v1",
  ])("does not disclose an account credential to %s", async (baseUrl) => {
    const transport = vi.fn();
    expect(mycelliosAccountUrl(baseUrl)).toBeNull();
    await expect(
      readMycelliosAccount({ ...connection, baseUrl }, { fetch: transport }),
    ).resolves.toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { ...account, asset: "USD" },
    { ...account, balanceMicrounits: "123" },
    { ...account, balanceMicrounits: Number.MAX_SAFE_INTEGER + 1 },
    { ...account, settledJobs: -1 },
  ])("rejects incompatible accounting instead of substituting a zero balance", async (body) => {
    await expect(
      readMycelliosAccount(connection, { fetch: vi.fn(async () => Response.json(body)) }),
    ).rejects.toThrow("temporarily unavailable");
  });

  it("hides upstream error bodies and rejects missing account credentials", async () => {
    await expect(
      readMycelliosAccount(connection, {
        fetch: vi.fn(
          async () => new Response("private diagnostics test-account-key", { status: 401 }),
        ),
      }),
    ).rejects.toThrow("Your balance has not been changed");
    const transport = vi.fn();
    await expect(
      readMycelliosAccount({ baseUrl: connection.baseUrl }, { fetch: transport }),
    ).rejects.toThrow("Connect your Mycellios account");
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds the account response", async () => {
    await expect(
      readMycelliosAccount(connection, {
        fetch: vi.fn(async () => new Response(" ".repeat(17_000))),
      }),
    ).rejects.toThrow("temporarily unavailable");
  });

  it("does not start a request after the caller has cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const transport = vi.fn();
    await expect(
      readMycelliosAccount(connection, { signal: abort.signal, fetch: transport }),
    ).rejects.toThrow("temporarily unavailable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("cancels a pending lookup without returning a cached or invented balance", async () => {
    const abort = new AbortController();
    const transport = vi.fn(async () => {
      abort.abort();
      throw new Error("private network diagnostic");
    });
    await expect(
      readMycelliosAccount(connection, { signal: abort.signal, fetch: transport }),
    ).rejects.toThrow("Your balance has not been changed");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("returns only the public accounting contract, excluding upstream private fields", async () => {
    await expect(
      readMycelliosAccount(connection, {
        fetch: vi.fn(async () =>
          Response.json({ ...account, privateAccountId: "fixture-private" }),
        ),
      }),
    ).resolves.toEqual(account);
  });
});
