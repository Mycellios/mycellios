import type { MycelliosAccount } from "@mycellios/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMycelliosAccountCache, createMycelliosModelsCache } from "./mycellios-account-cache.js";

const account = (balanceMicrounits: number): MycelliosAccount => ({
  object: "economic_account",
  asset: "MYC_MICROCREDITS",
  balanceMicrounits,
  lifetimeMicrounits: balanceMicrounits,
  settledJobs: 0,
});
const owner = { userId: "user-a", credentialId: "credential-a", baseUrl: "https://www.mycellios.com/v1", apiKey: "key-a" };

function fixture(options: { maxOwners?: number } = {}) {
  let time = 1_000;
  const read = createMycelliosAccountCache({ now: () => time, ...options });
  return { read, advance: (ms: number) => { time += ms; } };
}

describe("Mycellios account cache", () => {
  it("reuses a verified balance for the same owner within the TTL and reads again after it", async () => {
    const f = fixture();
    const load = vi.fn().mockResolvedValueOnce(account(1)).mockResolvedValueOnce(account(2));
    await expect(f.read(owner, load)).resolves.toEqual(account(1));
    f.advance(14_999);
    await expect(f.read(owner, load)).resolves.toEqual(account(1));
    expect(load).toHaveBeenCalledOnce();
    f.advance(1);
    await expect(f.read(owner, load)).resolves.toEqual(account(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["user", { userId: "user-b" }],
    ["connection", { credentialId: "credential-b" }],
    ["endpoint", { baseUrl: "https://sandbox.mycellios.com/v1" }],
    ["key", { apiKey: "key-b" }],
  ])("never shares a result across a different %s", async (_name, change) => {
    const f = fixture();
    const first = vi.fn().mockResolvedValue(account(1));
    const second = vi.fn().mockResolvedValue(account(2));
    await f.read(owner, first);
    await expect(f.read({ ...owner, ...change }, second)).resolves.toEqual(account(2));
    expect(second).toHaveBeenCalledOnce();
  });

  it("shares one in-flight authority read between concurrent identical requests", async () => {
    const f = fixture();
    let finish!: (value: MycelliosAccount) => void;
    const load = vi.fn(() => new Promise<MycelliosAccount>((resolve) => { finish = resolve; }));
    const reads = [f.read(owner, load), f.read(owner, load), f.read(owner, load)];
    finish(account(7));
    await expect(Promise.all(reads)).resolves.toEqual([account(7), account(7), account(7)]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("never caches a failure, so the next read retries instead of returning a value", async () => {
    const f = fixture();
    const load = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(account(3));
    await expect(f.read(owner, load)).rejects.toThrow("unavailable");
    await expect(f.read(owner, load)).resolves.toEqual(account(3));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bypasses a cached value on refresh and keeps the newer result", async () => {
    const f = fixture();
    let finishOld!: (value: MycelliosAccount) => void;
    const old = vi.fn(() => new Promise<MycelliosAccount>((resolve) => { finishOld = resolve; }));
    const pending = f.read(owner, old);
    await expect(f.read(owner, vi.fn().mockResolvedValue(account(9)), { refresh: true })).resolves.toEqual(account(9));
    finishOld(account(1));
    await pending;
    const cached = vi.fn();
    await expect(f.read(owner, cached)).resolves.toEqual(account(9));
    expect(cached).not.toHaveBeenCalled();
  });

  it("lets one caller cancel without failing the shared read for others", async () => {
    const f = fixture();
    let finish!: (value: MycelliosAccount) => void;
    const load = vi.fn(() => new Promise<MycelliosAccount>((resolve) => { finish = resolve; }));
    const abort = new AbortController();
    const cancelled = f.read(owner, load, { signal: abort.signal });
    const kept = f.read(owner, load);
    abort.abort(new Error("caller left"));
    await expect(cancelled).rejects.toThrow("caller left");
    finish(account(4));
    await expect(kept).resolves.toEqual(account(4));
  });

  it("bounds the number of owners it remembers", async () => {
    const f = fixture({ maxOwners: 2 });
    for (const userId of ["user-1", "user-2", "user-3"])
      await f.read({ ...owner, userId }, vi.fn().mockResolvedValue(account(1)));
    const evicted = vi.fn().mockResolvedValue(account(2));
    await expect(f.read({ ...owner, userId: "user-1" }, evicted)).resolves.toEqual(account(2));
    expect(evicted).toHaveBeenCalledOnce();
  });
});

describe("Mycellios models cache", () => {
  it("shares one catalog read per owner for a minute and never keeps an empty catalog", async () => {
    let time = 0;
    const read = createMycelliosModelsCache<string[]>({ now: () => time });
    const load = vi.fn().mockResolvedValueOnce(["a"]).mockResolvedValueOnce(["b"]);
    await expect(Promise.all([read(owner, load), read(owner, load)])).resolves.toEqual([["a"], ["a"]]);
    time += 59_999;
    await expect(read(owner, load)).resolves.toEqual(["a"]);
    time += 2;
    await expect(read(owner, load)).resolves.toEqual(["b"]);
    expect(load).toHaveBeenCalledTimes(2);
    const empty = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(["ready"]);
    const other = { ...owner, userId: "user-b" };
    await expect(read(other, empty)).resolves.toEqual([]);
    await expect(read(other, empty)).resolves.toEqual(["ready"]);
  });
});
