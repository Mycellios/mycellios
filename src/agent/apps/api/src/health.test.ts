import { InfisicalSecretStore } from "@mycellios/adapters";
import { describe, expect, it, vi } from "vitest";
import { infisicalFake } from "../../../packages/adapters/src/secret-store-fake.js";
import { DATABASE_CHECK_TIMEOUT_MS, healthRoutes, PUBLIC_STATUS_REUSE_MS } from "./health.js";

const app = healthRoutes(() => ({ runtime: "pi", sandbox: "docker", revision: "abc123" }));

describe("health routes", () => {
  it("reports degraded readiness during a store outage and recovers on later reads", async () => {
    const fake = infisicalFake();
    const writer = new InfisicalSecretStore(fake.options);
    const record = await writer.put("fake", {
      operationId: "test",
      traceId: "test",
      userId: "test",
      spaceId: "test",
      signal: new AbortController().signal,
    });
    await writer.close();
    fake.offline = true;
    const store = new InfisicalSecretStore(fake.options);
    await store.start();
    const health = healthRoutes(() => ({ degraded: store.describe().capabilities.degraded }));
    try {
      const response = await health.request("/ready");
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ ok: false, degraded: true });
      expect((await health.request("/health")).status).toBe(200);
      fake.offline = false;
      await store.load(record.ref, record.id);
      expect((await health.request("/ready")).status).toBe(200);
    } finally {
      await store.close();
    }
  });
  it("reports not ready while the database is unreachable", async () => {
    let up = false;
    const health = healthRoutes(
      () => ({}),
      async () => {
        if (!up) throw new Error("connection refused");
      },
    );
    const response = await health.request("/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      degraded: false,
      database: "unreachable",
    });
    expect((await health.request("/health")).status).toBe(200);
    up = true;
    expect((await health.request("/ready")).status).toBe(200);
  });

  it("answers 503 at the deadline while the database hangs, with one probe at a time", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(() => new Promise<never>(() => {}));
      const health = healthRoutes(() => ({}), check);
      const first = health.request("/ready");
      const second = health.request("/ready");
      expect((await health.request("/health")).status).toBe(200);
      await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);
      expect((await first).status).toBe(503);
      expect((await second).status).toBe(503);
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps public liveness free of deployment details", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("reports only the deployed revision on public readiness", async () => {
    const response = await app.request("/ready", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      degraded: false,
      revision: "abc123",
    });
    const unknown = healthRoutes(() => ({ revision: null }));
    await expect((await unknown.request("/ready")).json()).resolves.toEqual({
      ok: true,
      degraded: false,
    });
  });

  it("answers the public status read with ok or degraded and no details", async () => {
    let up = true;
    let degraded = false;
    const health = healthRoutes(
      () => ({ runtime: "pi", sandbox: "docker", revision: "abc123", degraded }),
      async () => {
        if (!up) throw new Error("connection refused at 10.0.0.5:5432");
      },
    );
    const read = async (headers?: Record<string, string>) => {
      vi.advanceTimersByTime(PUBLIC_STATUS_REUSE_MS);
      const response = await health.request("/api/v1/status", { headers });
      const text = await response.text();
      for (const detail of ["abc123", "revision", "database", "pi", "docker", "10.0.0.5"]) {
        expect(text).not.toContain(detail);
      }
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect([...response.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
      return { status: response.status, body: JSON.parse(text) as unknown };
    };
    vi.useFakeTimers();
    try {
      expect(await read()).toEqual({ status: 200, body: { status: "ok" } });
      expect(await read({ "x-forwarded-for": "203.0.113.7" })).toEqual({
        status: 200,
        body: { status: "ok" },
      });
      up = false;
      expect(await read()).toEqual({ status: 503, body: { status: "degraded" } });
      up = true;
      degraded = true;
      expect(await read()).toEqual({ status: 503, body: { status: "degraded" } });
      degraded = false;
      expect(await read()).toEqual({ status: 200, body: { status: "ok" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses one database answer for public status reads within the reuse window", async () => {
    vi.useFakeTimers();
    try {
      let up = true;
      const check = vi.fn(async () => {
        if (!up) throw new Error("down");
      });
      const health = healthRoutes(() => ({}), check);
      expect((await health.request("/api/v1/status")).status).toBe(200);
      up = false;
      expect((await health.request("/api/v1/status")).status).toBe(200);
      expect(check).toHaveBeenCalledTimes(1);
      // Orchestration readiness keeps its own fresh probe.
      expect((await health.request("/ready")).status).toBe(503);
      expect(check).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(PUBLIC_STATUS_REUSE_MS);
      expect((await health.request("/api/v1/status")).status).toBe(503);
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers degraded at the deadline while the database hangs", async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(() => new Promise<never>(() => {}));
      const health = healthRoutes(() => ({}), check);
      const first = health.request("/api/v1/status");
      const second = health.request("/api/v1/status");
      await vi.advanceTimersByTimeAsync(DATABASE_CHECK_TIMEOUT_MS);
      for (const response of [await first, await second]) {
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: "degraded" });
      }
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves details to direct requests on the API port", async () => {
    const response = await app.request("/internal/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runtime: "pi",
      sandbox: "docker",
      revision: "abc123",
      telemetry: { failures: 0, lastFailureAt: null, degraded: false },
    });
  });

  it("hides details from requests that came through a reverse proxy", async () => {
    for (const headers of [
      { "x-forwarded-for": "203.0.113.7" },
      { forwarded: "for=203.0.113.7;proto=https" },
    ]) {
      const response = await app.request("/internal/health", { headers });
      expect(response.status).toBe(404);
    }
  });
});
